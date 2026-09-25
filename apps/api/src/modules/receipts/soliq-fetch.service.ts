import { createHmac } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ParsedReceiptQr } from './qr-parser';

export interface SoliqCheckResult {
  verified: boolean;
  amount: bigint | null;
}

const API_URL = 'https://new-ofd.soliq.uz/api/payment';
// Reverse-engineered from ofd.soliq.uz's own frontend bundle (assets/index-*.js) —
// there is no public API doc for this endpoint. If soliq.uz ever rotates this key
// or changes the signing scheme, fetchAmount degrades to verified:false (see the
// class doc below), never to a hard failure for the client.
const SIGNING_SECRET = 'thisIsPaymentSecretKey123@#';

/**
 * Calls the same private JSON API that the public ofd.soliq.uz/check page's
 * frontend calls (the page itself is a client-rendered SPA with nothing in
 * the initial HTML — plain HTML scraping never sees the receipt data). This
 * is advisory/authoritative per TZ-4: soliq.uz being slow, down, or changing
 * its API must never block a client from earning a bonus; `verified: false`
 * just means "we couldn't confirm it," not "it's wrong" — the receipt falls
 * back to manual review instead.
 */
@Injectable()
export class SoliqFetchService {
  private readonly logger = new Logger(SoliqFetchService.name);

  constructor(private readonly config: ConfigService) {}

  async fetchAmount(_checkUrl: string, parsed?: ParsedReceiptQr): Promise<SoliqCheckResult> {
    if (!this.config.get<boolean>('SOLIQ_FETCH_ENABLED', true) || !parsed) {
      return { verified: false, amount: null };
    }

    const timeoutMs = this.config.get<number>('SOLIQ_FETCH_TIMEOUT_MS', 4000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = createHmac('sha256', SIGNING_SECRET)
        .update(`${parsed.t}:${parsed.r}:${timestamp}`)
        .digest('hex');

      const res = await fetch(API_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Timestamp': String(timestamp),
          'X-Signature': signature,
        },
        body: JSON.stringify({
          terminalId: parsed.t,
          paymentNo: parsed.r,
          paymentDate: parsed.c,
          paymentType: 'CHECK',
          fiscalSign: parsed.s,
        }),
      });

      const body = (await res.json().catch(() => null)) as {
        success?: boolean;
        data?: { cashTotal?: number; cardTotal?: number };
      } | null;

      if (!res.ok || !body?.success || !body.data) {
        this.logger.warn(`soliq.uz payment lookup failed (${res.status}) for terminal ${parsed.t}/${parsed.r}`);
        return { verified: false, amount: null };
      }

      const total = (body.data.cashTotal ?? 0) + (body.data.cardTotal ?? 0);
      return { verified: true, amount: BigInt(Math.round(total)) };
    } catch (err) {
      this.logger.warn(`soliq.uz fetch failed for terminal ${parsed.t}/${parsed.r}: ${(err as Error).message}`);
      return { verified: false, amount: null };
    } finally {
      clearTimeout(timer);
    }
  }
}
