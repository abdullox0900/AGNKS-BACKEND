import { FaceidService } from '../faceid.service';

const TODAY = new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);
const emp = (id: string, branch: string, start = '08:00') => ({ id, fullName: id, position: 'Kassir', active: true, branch: { id: branch, name: branch }, schedule: { start, end: '20:00', kind: 'day' as const } });

function setup(attendance: unknown, employees = [emp('a', 'b1'), emp('b', 'b1'), emp('c', 'b2'), emp('d', 'b1')]) {
  const client = {
    configured: true,
    get: jest.fn(async (path: string) => (path === 'employees' ? { items: employees } : path === 'attendance' ? attendance : { items: [] })),
  };
  const prisma = { faceidNote: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn(), delete: jest.fn() } };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  return { service: new FaceidService(client as never, prisma as never, audit as never), prisma, audit };
}

describe('FaceidService.day', () => {
  it('maps TimeFace states to the dashboard statuses', async () => {
    const day = (firstIn: string | null, lastOut: string | null, lateMinutes = 0, status = 'ON_TIME') => ({ firstIn, lastOut, workedMinutes: 120, lateMinutes, earlyLeaveMinutes: 0, status });
    const { service } = setup({
      date: TODAY,
      items: [
        { employee: { id: 'a' }, day: day(`${TODAY}T07:50:00+05:00`, null), state: 'onsite', terminalOnline: true },
        { employee: { id: 'b' }, day: day(`${TODAY}T08:20:00+05:00`, `${TODAY}T12:00:00+05:00`, 20, 'LATE'), state: 'left', terminalOnline: true },
        { employee: { id: 'c' }, day: null, state: 'absent', terminalOnline: false },
        { employee: { id: 'd' }, day: null, state: 'absent', terminalOnline: true },
      ],
    });
    const { records } = await service.day(TODAY);
    const by = Object.fromEntries(records.map((r) => [r.employeeId, r]));
    expect(by.a).toMatchObject({ status: 'came', in: '07:50', early: 10, now: true });
    expect(by.b).toMatchObject({ status: 'late', in: '08:20', out: '12:00', late: 20 });
    expect(by.b.now).toBeUndefined();
    // silent terminal today → unknown, not "absent"
    expect(by.c).toMatchObject({ status: 'pending', blind: true });
    expect(by.d.status).toBe('absent');
  });

  it('does not call a past day "blind" even if the terminal is offline now', async () => {
    const { service } = setup({ date: '2026-01-05', items: [{ employee: { id: 'c' }, day: null, state: 'absent', terminalOnline: false }] });
    const { records } = await service.day('2026-01-05');
    expect(records[0]).toMatchObject({ status: 'absent' });
    expect(records[0].blind).toBeUndefined();
  });
});

describe('FaceidService.saveNote', () => {
  it('stores a reason + note and audits it', async () => {
    const { service, prisma, audit } = setup({ items: [] });
    await service.saveNote('u1', { employeeId: 'a', date: '2026-11-13', reason: 'sick', note: ' Kasal ' });
    expect(prisma.faceidNote.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ reason: 'sick', note: 'Kasal', updatedBy: 'u1' }) }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'faceid.note' }));
  });
  it('removes the note when both fields are empty', async () => {
    const { service, prisma } = setup({ items: [] });
    prisma.faceidNote.findUnique.mockResolvedValue({ reason: 'sick', note: 'x' });
    await service.saveNote('u1', { employeeId: 'a', date: '2026-11-13', reason: null, note: '  ' });
    expect(prisma.faceidNote.delete).toHaveBeenCalled();
    expect(prisma.faceidNote.upsert).not.toHaveBeenCalled();
  });
});
