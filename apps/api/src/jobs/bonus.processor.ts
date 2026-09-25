import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { QUEUE_NAMES } from '@/infra/queue/queue.constants';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { LedgerService } from '@/modules/ledger/ledger.service';
import { SettingsService } from '@/modules/rules/settings.service';
import { NotificationsService } from '@/modules/notifications/notifications.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const WARNING_DAYS_BEFORE = 7;

@Processor(QUEUE_NAMES.bonusExpire, { concurrency: 1 })
export class BonusExpireProcessor extends WorkerHost {
  private readonly logger = new Logger(BonusExpireProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
  ) {
    super();
  }

  async process(): Promise<void> {
    const expiryDays = await this.settings.get('bonus.expiry_days');
    if (!expiryDays || expiryDays <= 0) return; // 0 = muddatsiz

    await this.warnExpiringSoon(expiryDays);
    await this.expireStale(expiryDays);
  }

  private async warnExpiringSoon(expiryDays: number): Promise<void> {
    const warnAt = new Date(Date.now() - (expiryDays - WARNING_DAYS_BEFORE) * DAY_MS);
    const windowStart = new Date(warnAt.getTime() - DAY_MS);

    const cards = await this.prisma.card.findMany({
      where: { cachedBalance: { gt: 0n }, lastActivityAt: { gte: windowStart, lt: warnAt } },
    });

    for (const card of cards) {
      await this.notifications.enqueue('client.bonus_expiry_warning', {
        cardId: card.id,
        amount: card.cachedBalance.toString(),
        days: WARNING_DAYS_BEFORE,
      });
    }
    if (cards.length > 0) this.logger.log(`Sent expiry warnings to ${cards.length} card(s)`);
  }

  private async expireStale(expiryDays: number): Promise<void> {
    const cutoff = new Date(Date.now() - expiryDays * DAY_MS);
    const cards = await this.prisma.card.findMany({
      where: { cachedBalance: { gt: 0n }, lastActivityAt: { lt: cutoff } },
    });

    for (const card of cards) {
      await this.prisma.$transaction(async (tx) => {
        const fresh = await tx.card.findUnique({ where: { id: card.id } });
        if (!fresh || fresh.cachedBalance <= 0n) return;

        await this.ledger.post(tx, {
          cardId: card.id,
          delta: -fresh.cachedBalance,
          type: 'expire',
          refType: 'system',
          refId: card.id,
        });
        await this.notifications.enqueue('client.bonus_expired', { cardId: card.id }, tx);
      });
    }
    if (cards.length > 0) this.logger.log(`Expired bonus balance on ${cards.length} card(s)`);
  }
}
