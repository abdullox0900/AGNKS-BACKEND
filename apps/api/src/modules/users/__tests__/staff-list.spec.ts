import { StaffService } from '../staff.service';

const rows = [
  { id: 'r1', userId: 'u1', role: 'cashier', stationId: 's1', user: {}, station: {} },
  { id: 'r2', userId: 'u2', role: 'seo', stationId: null, user: {}, station: null },
];

function setup() {
  const findMany = jest.fn(async ({ where }: { where: { role?: string } }) => rows.filter((r) => !where.role || r.role === where.role));
  const readPasswords = jest.fn(async (ids: string[]) => new Map(ids.map((id) => [id, `pw-${id}`])));
  const svc = new StaffService({ userRole: { findMany } } as never, {} as never, {} as never, { readPasswords } as never);
  return { svc, findMany, readPasswords };
}
const actor = (role: string) => ({ kind: 'staff', userId: 'x', role, stationId: null, terminalIds: [] }) as never;

describe('StaffService.list for root_admin (view-only)', () => {
  it('returns cashiers only, without passwords, and never asks for any', async () => {
    const { svc, readPasswords } = setup();
    const out = await svc.list(actor('root_admin'));
    expect(out.map((r) => r.role)).toEqual(['cashier']);
    expect(out[0]).not.toHaveProperty('password');
    expect(readPasswords).not.toHaveBeenCalled();
  });

  it('refuses to list dashboard accounts when asked for them explicitly', async () => {
    const { svc } = setup();
    await expect(svc.list(actor('root_admin'), 'seo')).rejects.toMatchObject({ code: 'AUTH_FORBIDDEN' });
  });

  it('SEO still sees everyone, with passwords', async () => {
    const { svc } = setup();
    const out = await svc.list(actor('seo'));
    expect(out.map((r) => r.role)).toEqual(['cashier', 'seo']);
    expect(out.every((r) => 'password' in r)).toBe(true);
  });
});
