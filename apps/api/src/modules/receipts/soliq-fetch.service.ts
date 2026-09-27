import { createHmac } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ParsedReceiptQr } from './qr-parser';

export interface SoliqCheckResult {
  verified: boolean;
  amount: bigint | null;
  /** full soliq.uz payment record, when one came back */
  data: Record<string, unknown> | null;
  /** why it couldn't be used, when verified is false */
  reason?: SoliqRejectReason;
}

export type SoliqRejectReason = 'tax_unverified' | 'tax_mismatch' | 'tax_refund';

/**
 * Decides whether a soliq.uz payment record can be trusted for this QR and what the
 * receipt total is. Used for both our own lookup and the record the webapp fetched on
 * the client's phone — the latter must match the QR we parsed ourselves (terminal,
 * receipt number, date), so a record for some other receipt can't be replayed.
 */
export function evaluateSoliqData(data: Record<string, unknown>, parsed: ParsedReceiptQr): SoliqCheckResult {
  const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

  const sameTerminal = str(data.terminalId) === parsed.t;
  const sameNumber = str(data.paymentNo).replace(/^0+/, '') === parsed.r.replace(/^0+/, '');
  // soliq.uz: "25.09.2026 17:07:21"; QR `c`: "20260925170721"
  const m = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(str(data.paymentDate));
  const sameDate = !!m && `${m[3]}${m[2]}${m[1]}${m[4]}${m[5]}${m[6]}` === parsed.c;
  if (!sameTerminal || !sameNumber || !sameDate) {
    return { verified: false, amount: null, data, reason: 'tax_mismatch' };
  }

  if (Number(data.isRefund) === 1) {
    return { verified: false, amount: null, data, reason: 'tax_refund' };
  }

  const cash = Number(data.cashTotal ?? 0);
  const card = Number(data.cardTotal ?? 0);
  if (!Number.isFinite(cash) || !Number.isFinite(card) || cash < 0 || card < 0) {
    return { verified: false, amount: null, data, reason: 'tax_mismatch' };
  }
  return { verified: true, amount: BigInt(Math.round(cash + card)), data };
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

  /** `timeoutMs` overrides the configured timeout (shorter when the webapp already sent its own lookup). */
  async fetchAmount(_checkUrl: string, parsed?: ParsedReceiptQr, timeoutMs?: number): Promise<SoliqCheckResult> {
    if (!this.config.get<boolean>('SOLIQ_FETCH_ENABLED', true) || !parsed) {
      return { verified: false, amount: null, data: null, reason: 'tax_unverified' };
    }

    timeoutMs ??= Number(this.config.get('SOLIQ_FETCH_TIMEOUT_MS', 4000));
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
        data?: Record<string, unknown>;
      } | null;

      if (!res.ok || !body?.success || !body.data) {
        this.logger.warn(`soliq.uz payment lookup failed (${res.status}) for terminal ${parsed.t}/${parsed.r}`);
        return { verified: false, amount: null, data: null, reason: 'tax_unverified' };
      }

      return evaluateSoliqData(body.data, parsed);
    } catch (err) {
      this.logger.warn(`soliq.uz fetch failed for terminal ${parsed.t}/${parsed.r}: ${(err as Error).message}`);
      return { verified: false, amount: null, data: null, reason: 'tax_unverified' };
    } finally {
      clearTimeout(timer);
    }
  }
}
