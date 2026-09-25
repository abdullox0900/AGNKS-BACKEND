import type { Logger } from '@nestjs/common';

/**
 * Prisma returns `bigint` for our money columns. Node's JSON.stringify
 * throws on bigint by default — this makes every bigint serialize as a
 * string instead of crashing whichever response happens to include one
 * (a defense-in-depth net; DTOs still convert to `number` explicitly where
 * that's the documented contract).
 */
export function installBigIntJsonSupport(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (BigInt.prototype as any).toJSON = function (this: bigint) {
    return this.toString();
  };
}

/**
 * TZ-4 §11: "bitta xato butun API'ni to'xtatmasin." Nest's own exception
 * filter already catches everything thrown inside a request; this is the
 * outer net for anything that still escapes — a bug in a background
 * `setTimeout`, an unawaited promise, a third-party library. We log it and
 * keep the process alive rather than let Node's default behavior kill it.
 */
export function installProcessGuards(logger: Logger): void {
  process.on('uncaughtException', (err) => {
    logger.error(`uncaughtException: ${err.message}`, err.stack);
  });
  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    logger.error(`unhandledRejection: ${err.message}`, err.stack);
  });
}
