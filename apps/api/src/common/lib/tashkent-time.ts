const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;

/** Start/end of the Asia/Tashkent calendar day (UTC+5, no DST) containing `at`. */
export function tashkentDayRange(at: Date = new Date()): { start: Date; end: Date } {
  const shifted = new Date(at.getTime() + TASHKENT_OFFSET_MS);
  const start = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: new Date(start.getTime() - TASHKENT_OFFSET_MS), end: new Date(end.getTime() - TASHKENT_OFFSET_MS) };
}
