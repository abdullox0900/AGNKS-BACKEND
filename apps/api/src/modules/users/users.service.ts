import { Injectable } from '@nestjs/common';
import { AppError, type MeResponse, type RegisterDto, type UpdateMeDto } from '@agnks/types';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { SettingsService } from '@/modules/rules/settings.service';
import { RateResolverService } from '@/modules/rules/rate-resolver.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly rateResolver: RateResolverService,
  ) {}

  async getMe(userId: string): Promise<MeResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { card: true },
    });
    if (!user || !user.card) throw new AppError('NOT_FOUND');

    const registered = !!user.registeredAt;
    const marketingConsent = await this.prisma.consent.findFirst({
      where: { userId, type: 'marketing', revokedAt: null },
      select: { id: true },
    });

    const [minAmount, maxAmount, spendMin, spendMax, methanePrice] = await Promise.all([
      this.settings.get('receipt.min_amount'),
      this.settings.get('receipt.max_amount'),
      this.settings.get('spend.min_amount'),
      this.settings.get('spend.max_amount'),
      this.settings.get('methane.price'),
    ]);

    return {
      id: user.id,
      firstName: user.firstName,
      phone: user.phone,
      lang: user.lang,
      registered,
      cardNumber: user.card.number,
      balance: Number(user.card.cachedBalance),
      pendingAmount: Number(user.card.pendingAmount),
      cardBlocked: user.card.blocked,
      receiptMinAmount: minAmount,
      receiptMaxAmount: maxAmount,
      spendMinAmount: spendMin,
      spendMaxAmount: spendMax,
      marketingOptIn: !!marketingConsent,
      methanePrice,
    };
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { firstName: dto.firstName, lang: dto.lang, phone: dto.phone },
    });
    return this.getMe(userId);
  }

  async register(userId: string, dto: RegisterDto) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { firstName: dto.firstName, registeredAt: new Date() },
    });
    return this.getMe(userId);
  }

  async setMarketingConsent(userId: string, accepted: boolean, version: string): Promise<void> {
    if (accepted) {
      const active = await this.prisma.consent.findFirst({
        where: { userId, type: 'marketing', revokedAt: null },
      });
      if (!active) {
        await this.prisma.consent.create({ data: { userId, type: 'marketing', version } });
      }
    } else {
      await this.prisma.consent.updateMany({
        where: { userId, type: 'marketing', revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  }

  async rate(stationId?: string) {
    const now = new Date();
    const resolved = stationId
      ? await this.rateResolver.resolve(stationId, now)
      : { rateBps: await this.settings.get('bonus.base_rate_bps'), promotionId: null };

    if (!resolved.promotionId) {
      return { basePercent: resolved.rateBps / 100, promo: null };
    }

    const promo = await this.prisma.promotion.findUnique({ where: { id: resolved.promotionId } });
    return {
      basePercent: await this.settings.get('bonus.base_rate_bps').then((v) => v / 100),
      promo: promo
        ? { id: promo.id, name: promo.name, percent: promo.rateBps / 100, endsAt: promo.endsAt.toISOString() }
        : null,
    };
  }

  /**
   * "Chiqish" in the Mini App: Telegram identity can't be signed out, so this
   * resets registration instead — phone/registeredAt are cleared and the client
   * goes through onboarding again (e.g. to use another number). The card,
   * balance and history stay attached to this Telegram account.
   */
  async logout(userId: string): Promise<{ registered: false }> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { phone: null, registeredAt: null },
    });
    return { registered: false };
  }

  /** Client-facing list of running + upcoming promotions (cancelled/ended are hidden). */
  async promotions() {
    const now = new Date();
    const rows = await this.prisma.promotion.findMany({
      where: { cancelledAt: null, endsAt: { gte: now } },
      orderBy: { startsAt: 'asc' },
      take: 50,
    });
    const stationIds = [...new Set(rows.flatMap((p) => p.stationIds))];
    const stations = stationIds.length
      ? await this.prisma.station.findMany({ where: { id: { in: stationIds } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(stations.map((s) => [s.id, s.name]));
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      percent: p.rateBps / 100,
      startsAt: p.startsAt.toISOString(),
      endsAt: p.endsAt.toISOString(),
      active: p.startsAt <= now,
      // empty = whole network
      stations: p.stationIds.map((id) => nameById.get(id)).filter((n): n is string => !!n),
    }));
  }

  /**
   * Full registration done entirely inside the bot conversation (name, then a
   * shared contact) — by the time the client opens the Mini App, `registered`
   * is already true and the in-app onboarding pages are skipped. Creates the
   * user+card if this is the very first contact from this Telegram id (they
   * may `/start` the bot before ever opening the webapp).
   */
  /** A client who finished bot registration (and hasn't logged out of the webapp). */
  findRegisteredByTg(tgUserId: number) {
    return this.prisma.user.findFirst({
      where: { tgUserId: BigInt(tgUserId), registeredAt: { not: null } },
      select: { firstName: true, lang: true },
    });
  }

  async registerFromBot(tgUserId: number, firstName: string, phone: string): Promise<void> {
    const normalizedPhone = normalizePhone(phone);
    await this.prisma.user.upsert({
      where: { tgUserId: BigInt(tgUserId) },
      create: {
        tgUserId: BigInt(tgUserId),
        firstName,
        phone: normalizedPhone,
        registeredAt: new Date(),
        card: { create: { number: generateCardNumber() } },
      },
      update: { firstName, phone: normalizedPhone, registeredAt: new Date() },
    });
  }
}

function generateCardNumber(): string {
  const digits = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)).join('');
  return `AG${digits}`;
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/[^\d]/g, '');
  return digits.startsWith('998') ? `+${digits}` : `+998${digits.slice(-9)}`;
}
