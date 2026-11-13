import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError } from '@agnks/types';

/**
 * Read-only client for TimeFace's public API (`X-API-Key`, GET only, 120 requests/min per key).
 * The key lives only in this server's .env — the browser never sees it. Answers are cached for a few
 * seconds so one dashboard page (several widgets, several viewers) is one upstream call, not many.
 */
@Injectable()
export class FaceidClient {
  private readonly logger = new Logger(FaceidClient.name);
  private readonly cache = new Map<string, { at: number; value: unknown }>();
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string {
    return this.config.get<string>('FACEID_API_URL', 'https://server.agnks-control.uz/api/v1/public').replace(/\/+$/, '');
  }
  private get key(): string {
    return (this.config.get<string>('FACEID_API_KEY', '') ?? '').trim();
  }
  get configured(): boolean {
    return this.key.length > 0;
  }

  async get<T>(path: string, query: Record<string, string | number | undefined> = {}, ttlMs = 15_000): Promise<T> {
    if (!this.configured) throw new AppError('FACEID_NOT_CONFIGURED');
    const qs = new URLSearchParams(Object.entries(query).flatMap(([k, v]) => (v === undefined || v === '' ? [] : [[k, String(v)]]))).toString();
    const url = `${this.baseUrl}/${path}${qs ? `?${qs}` : ''}`;

    const hit = this.cache.get(url);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
    const pending = this.inflight.get(url);
    if (pending) return pending as Promise<T>;

    const run = this.fetchJson<T>(url)
      .then((value) => {
        this.cache.set(url, { at: Date.now(), value });
        if (this.cache.size > 400) this.cache.delete(this.cache.keys().next().value as string);
        return value;
      })
      .finally(() => this.inflight.delete(url));
    this.inflight.set(url, run);
    return run;
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(url, { headers: { 'X-API-Key': this.key, Accept: 'application/json' }, signal: controller.signal });
      if (!res.ok) {
        this.logger.warn(`TimeFace ${res.status} for ${url.replace(this.baseUrl, '')}`);
        throw new AppError('FACEID_UNAVAILABLE', { status: res.status });
      }
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof AppError) throw err;
      this.logger.warn(`TimeFace request failed: ${(err as Error).message}`);
      throw new AppError('FACEID_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
    }
  }
}
