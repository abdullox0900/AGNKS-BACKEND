import type { PrismaService } from '@/infra/prisma/prisma.service';

/**
 * The stations a client "belongs" to: the one(s) whose own Telegram bot they use, plus every station where they
 * scanned a receipt or redeemed bonus. Decides which station-limited promotions they see.
 */
export async function clientStationIds(prisma: PrismaService, cardId: string): Promise<Set<string>> {
  const card = await prisma.card.findUnique({ where: { id: cardId }, select: { user: { select: { botKey: true } } } });
  const botKey = card?.user.botKey ?? null;
  const [ofBot, receipts, spends] = await Promise.all([
    botKey ? prisma.station.findMany({ where: { botKey }, select: { id: true } }) : Promise.resolve([] as { id: string }[]),
    prisma.receipt.findMany({ where: { cardId, status: { not: 'rejected' } }, select: { stationId: true }, distinct: ['stationId'] }),
    prisma.spendOperation.findMany({ where: { cardId }, select: { stationId: true }, distinct: ['stationId'] }),
  ]);
  return new Set([...ofBot.map((s) => s.id), ...receipts.map((r) => r.stationId), ...spends.map((s) => s.stationId)]);
}
