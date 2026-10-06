import { DataFixGateService } from '../data-fix-gate.service';
import { DataFixUnlockedGuard } from '../data-fix-unlocked.guard';

function setup() {
  let stored: { value: unknown } | null = null;
  const prisma = {
    setting: {
      findUnique: jest.fn(async () => stored),
      upsert: jest.fn(async ({ create }: { create: { value: unknown } }) => (stored = { value: create.value })),
      update: jest.fn(async ({ data }: { data: { value: unknown } }) => (stored = { value: data.value })),
    },
  };
  const audit = { record: jest.fn() };
  const auth = { verifyPassword: jest.fn(async (_id: string, pw: string) => pw === 'login-pass') };
  const config = { get: (_k: string, d?: string) => d ?? 'test-secret' };
  const svc = new DataFixGateService(prisma as never, config as never, auth as never, audit as never);
  return { svc, prisma, audit, stored: () => stored };
}
const code = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return (e as { code: string }).code; } };

describe('DataFixGateService — the data-fix page password', () => {
  it('starts unset; setting it needs the SEO login password and a long-enough value is stored only as a hash', async () => {
    const { svc, stored } = setup();
    expect(await svc.status()).toEqual({ configured: false });
    expect(await code(svc.setup('seo1', 'my-gate-pass', 'wrong-login'))).toBe('AUTH_INVALID_CREDENTIALS');
    await svc.setup('seo1', 'my-gate-pass', 'wrong-login').catch((e) => expect(e.details).toEqual({ reason: 'login_password' }));
    const res = await svc.setup('seo1', 'my-gate-pass', 'login-pass');
    expect(res.token).toBeTruthy();
    expect(await svc.status()).toEqual({ configured: true });
    expect(JSON.stringify(stored())).not.toContain('my-gate-pass');
    expect(JSON.stringify(stored())).toContain('$argon2');
    expect(await code(svc.setup('seo2', 'another-one', 'login-pass'))).toBe('VALIDATION_ERROR'); // already set
  });

  it('unlock: right password gives a token for that user only; wrong one is refused', async () => {
    const { svc } = setup();
    await svc.setup('seo1', 'my-gate-pass', 'login-pass');
    expect(await code(svc.unlock('seo1', 'nope'))).toBe('AUTH_INVALID_CREDENTIALS');
    const { token } = await svc.unlock('seo1', 'my-gate-pass');
    expect(svc.verify(token, 'seo1')).toBe(true);
    expect(svc.verify(token, 'seo2')).toBe(false);
    expect(svc.verify(token + 'x', 'seo1')).toBe(false);
    expect(svc.verify(undefined, 'seo1')).toBe(false);
  });

  it('tokens expire after 15 minutes', async () => {
    const { svc } = setup();
    await svc.setup('seo1', 'my-gate-pass', 'login-pass');
    const { token } = await svc.unlock('seo1', 'my-gate-pass');
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 16 * 60_000);
    expect(svc.verify(token, 'seo1')).toBe(false);
    jest.restoreAllMocks();
  });

  it('five wrong passwords lock the user out, even for the right password', async () => {
    const { svc } = setup();
    await svc.setup('seo1', 'my-gate-pass', 'login-pass');
    for (let i = 0; i < 5; i++) expect(await code(svc.unlock('seo1', 'bad'))).toBe('AUTH_INVALID_CREDENTIALS');
    expect(await code(svc.unlock('seo1', 'my-gate-pass'))).toBe('RATE_LIMITED');
  });

  it('change: needs the current gate password and the new one works afterwards', async () => {
    const { svc } = setup();
    await svc.setup('seo1', 'my-gate-pass', 'login-pass');
    expect(await code(svc.change('seo1', 'wrong', 'brand-new-pass'))).toBe('AUTH_INVALID_CREDENTIALS');
    await svc.change('seo1', 'my-gate-pass', 'brand-new-pass');
    expect(await code(svc.unlock('seo1', 'my-gate-pass'))).toBe('AUTH_INVALID_CREDENTIALS');
    expect((await svc.unlock('seo1', 'brand-new-pass')).token).toBeTruthy();
  });

  it('the guard refuses requests without a valid token and lets valid ones through', async () => {
    const { svc } = setup();
    await svc.setup('seo1', 'my-gate-pass', 'login-pass');
    const { token } = await svc.unlock('seo1', 'my-gate-pass');
    const guard = new DataFixUnlockedGuard(svc);
    const ctx = (hdr?: string) => ({ switchToHttp: () => ({ getRequest: () => ({ actor: { kind: 'staff', userId: 'seo1' }, header: () => hdr }) }) }) as never;
    expect(guard.canActivate(ctx(token))).toBe(true);
    expect(() => guard.canActivate(ctx(undefined))).toThrow();
    expect(() => guard.canActivate(ctx('garbage'))).toThrow();
  });
});
