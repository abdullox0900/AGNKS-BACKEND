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

/**
 * Decides, for one client, whether an offer limited to some stations is theirs to see.
 * Yes when it is network-wide, when one of its stations is the client's (see above), or when one of its stations has
 * no Telegram bot linked yet — we cannot tell then, and an offer must never vanish just because that setting is missing.
 */
export async function stationVisibility(prisma: PrismaService, cardId: string, referencedStationIds: string[]): Promise<(stationIds: string[]) => boolean> {
  if (referencedStationIds.length === 0) return () => true;
  const [mine, stations] = await Promise.all([
    clientStationIds(prisma, cardId),
    prisma.station.findMany({ where: { id: { in: referencedStationIds } }, select: { id: true, botKey: true } }),
  ]);
  const unlinked = new Set(stations.filter((s) => !s.botKey).map((s) => s.id));
  return (ids) => ids.length === 0 || ids.some((id) => mine.has(id) || unlinked.has(id));
}
