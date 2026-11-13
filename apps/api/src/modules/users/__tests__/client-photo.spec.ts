import { ClientPhotoService } from '../client-photo.service';

const config = { get: () => 'test-secret' };
const svc = new ClientPhotoService({} as never, config as never, { get: () => undefined, fallback: () => undefined } as never);

describe('ClientPhotoService signed URLs', () => {
  it('gives no URL without Telegram', () => {
    expect(svc.urlFor('u1', false)).toBeNull();
  });
  it('accepts its own signature and rejects a forged or expired one', () => {
    const now = Date.UTC(2026, 10, 14, 10);
    const url = new URL(`http://x${svc.urlFor('u1', true, now)}`);
    const e = url.searchParams.get('e')!;
    const s = url.searchParams.get('s')!;
    expect(svc.verify('u1', e, s, now)).toBe(true);
    expect(svc.verify('u2', e, s, now)).toBe(false);
    expect(svc.verify('u1', e, s.replace(/.$/, s.endsWith('A') ? 'B' : 'A'), now)).toBe(false);
    expect(svc.verify('u1', e, s, Number(e) + 1)).toBe(false);
  });
  it('keeps the same URL for the whole day (browser cache)', () => {
    const a = svc.urlFor('u1', true, Date.UTC(2026, 10, 14, 1));
    const b = svc.urlFor('u1', true, Date.UTC(2026, 10, 14, 23));
    expect(a).toBe(b);
  });
});
