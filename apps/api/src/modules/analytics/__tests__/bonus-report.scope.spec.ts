import { BonusReportService } from '../bonus-report.service';

const svc = new BonusReportService({} as never);
const actor = (role: string, stationId: string | null = null) => ({ kind: 'staff', userId: 'u', role, stationId, terminalIds: [] }) as never;

describe('BonusReportService.scope', () => {
  it('network-wide roles get what they ask for (or everything)', () => {
    expect(svc.scope(actor('seo'), ['a', 'b'])).toEqual(['a', 'b']);
    expect(svc.scope(actor('root_admin'))).toBeUndefined();
    expect(svc.scope(actor('seo'), [])).toBeUndefined();
  });

  it("a branch manager is always limited to their own station, whatever they send", () => {
    expect(svc.scope(actor('branch_manager', 's1'), ['other'])).toEqual(['s1']);
    expect(svc.scope(actor('branch_manager', 's1'))).toEqual(['s1']);
  });

  it('a branch manager without a station sees nothing', () => {
    expect(svc.scope(actor('branch_manager', null))).toEqual(['__none__']);
  });
});
