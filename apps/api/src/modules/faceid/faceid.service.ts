import { Injectable } from '@nestjs/common';
import { AppError } from '@agnks/types';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AuditService } from '@/modules/audit/audit.service';
import { FaceidClient } from './faceid.client';

// ---- what TimeFace sends (see its /api/v1/public) ----
interface UBranch {
  id: string;
  name: string;
  terminal: { online: boolean; lastSeenAt: string | null };
}
interface UEmployee {
  id: string;
  fullName: string;
  position: string | null;
  branch: { id: string; name: string };
  schedule: { start: string; end: string; kind: 'day' | 'night' } | null;
}
interface UDay {
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  status: 'ON_TIME' | 'LATE' | 'ABSENT' | 'DAY_OFF';
}
interface UAttendance {
  date: string;
  items: { employee: { id: string }; day: UDay | null; state: 'onsite' | 'left' | 'absent' | 'dayoff' | 'pending'; terminalOnline: boolean }[];
}
interface URange {
  items: (UDay & { employeeId: string; date: string })[];
}
interface UEvents {
  items: { id: string; employeeId: string | null; kind: 'in' | 'out' | string; at: string; branch: { id: string } }[];
}

// ---- what the dashboard gets ----
export type FaceStatus = 'came' | 'late' | 'absent' | 'off' | 'pending';
export interface FaceRecord {
  employeeId: string;
  date: string;
  status: FaceStatus;
  in?: string;
  out?: string;
  late?: number;
  early?: number;
  worked?: number;
  /** still at work right now */
  now?: boolean;
  /** today, and the branch terminal is silent: nothing is known about this person yet */
  blind?: boolean;
}
export interface FaceNote {
  reason: string | null;
  note: string | null;
}

const MAX_CHUNK_DAYS = 62;
const DAY_MS = 86_400_000;
const REASONS = ['sick', 'leave', 'none', 'trip', 'other'] as const;

const todayTashkent = () => new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);
/** TimeFace already sends +05:00 timestamps, so the wall clock is just a slice of the string. */
const hhmm = (iso: string | null | undefined) => (iso && iso.length >= 16 ? iso.slice(11, 16) : undefined);
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** Reads TimeFace (read-only), turns it into the shapes the FaceID screens use, and keeps the managers' notes here. */
@Injectable()
export class FaceidService {
  constructor(
    private readonly client: FaceidClient,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  status() {
    return { configured: this.client.configured };
  }

  async branches() {
    const res = await this.client.get<{ items: UBranch[] }>('branches', {}, 60_000);
    return res.items.map((b) => ({
      id: b.id,
      name: b.name,
      online: b.terminal.online,
      lastSeenMin: b.terminal.lastSeenAt ? Math.max(0, Math.round((Date.now() - Date.parse(b.terminal.lastSeenAt)) / 60_000)) : null,
    }));
  }

  private async employeesRaw(): Promise<UEmployee[]> {
    return (await this.client.get<{ items: UEmployee[] }>('employees', { active: 'true' }, 5 * 60_000)).items;
  }

  /** employee id → absolute photo URL. Photos need the full-access key; without it (or on any error) there are simply none. */
  private async photos(): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    try {
      for (let page = 1; page <= 20; page++) {
        const res = await this.client.get<{ total: number; items: { id: string; photoUrl?: string | null }[] }>('employees', { page, pageSize: 100 }, 10 * 60_000, true);
        for (const e of res.items) if (e.photoUrl) out.set(e.id, e.photoUrl.startsWith('http') ? e.photoUrl : `${this.client.origin}${e.photoUrl}`);
        if (!res.items.length || page * 100 >= res.total) break;
      }
    } catch {
      // read-only key or TimeFace hiccup: the screens fall back to initials
    }
    return out;
  }

  async employees() {
    const photos = await this.photos();
    return (await this.employeesRaw()).map((e) => ({
      photo: photos.get(e.id) ?? null,
      id: e.id,
      name: e.fullName,
      position: e.position ?? '',
      branchId: e.branch.id,
      shift: e.schedule?.kind === 'night' ? ('night' as const) : ('day' as const),
    }));
  }

  /** Minutes before the shift start the person arrived (only when they were not late). */
  private early(inTime: string | undefined, start: string | undefined): number | undefined {
    if (!inTime || !start) return undefined;
    const diff = toMin(start) - toMin(inTime);
    return diff > 0 && diff <= 360 ? diff : undefined;
  }

  /** One day for every active employee, with "now / pending / blind" known for today. */
  async day(date: string) {
    const today = todayTashkent();
    const [att, emps, notes] = await Promise.all([
      this.client.get<UAttendance>('attendance', { date }, date === today ? 15_000 : 10 * 60_000),
      this.employeesRaw(),
      this.notesFor(date, date),
    ]);
    const start = new Map(emps.map((e) => [e.id, e.schedule?.start]));
    const records: FaceRecord[] = att.items.map((it) => {
      const id = it.employee.id;
      const inT = hhmm(it.day?.firstIn);
      const outT = hhmm(it.day?.lastOut);
      const isToday = date === today;
      const blind = isToday && !it.terminalOnline && !inT;
      let status: FaceStatus;
      if (it.state === 'dayoff') status = 'off';
      else if (it.state === 'pending' || blind) status = 'pending';
      else if (it.state === 'absent') status = 'absent';
      else status = it.day?.status === 'LATE' ? 'late' : 'came';
      const now = isToday && it.state === 'onsite';
      const worked = it.day?.workedMinutes ? it.day.workedMinutes : now && inT ? Math.max(0, toMin(new Date(Date.now() + 5 * 3_600_000).toISOString().slice(11, 16)) - toMin(inT)) : undefined;
      return {
        employeeId: id,
        date,
        status,
        ...(inT ? { in: inT } : {}),
        ...(outT ? { out: outT } : {}),
        ...(status === 'late' && it.day?.lateMinutes ? { late: it.day.lateMinutes } : {}),
        ...(status === 'came' ? { early: this.early(inT, start.get(id)) } : {}),
        ...(worked !== undefined ? { worked } : {}),
        ...(now ? { now: true } : {}),
        ...(blind ? { blind: true } : {}),
      };
    });
    return { date, records, notes };
  }

  /** Many days at once (month calendar, analytics). Split into TimeFace-sized chunks of 62 days. */
  async range(from: string, to: string) {
    if (to < from) throw new AppError('VALIDATION_ERROR', { reason: 'range_reversed' });
    const spanDays = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
    if (spanDays > 200) throw new AppError('VALIDATION_ERROR', { reason: 'range_too_long' });
    const chunks: [string, string][] = [];
    for (let a = from; a <= to; a = addDays(a, MAX_CHUNK_DAYS)) chunks.push([a, addDays(a, MAX_CHUNK_DAYS - 1) < to ? addDays(a, MAX_CHUNK_DAYS - 1) : to]);

    const [parts, emps, notes] = await Promise.all([
      Promise.all(chunks.map(([a, b]) => this.client.get<URange>('attendance/range', { from: a, to: b }, 60_000))),
      this.employeesRaw(),
      this.notesFor(from, to),
    ]);
    const start = new Map(emps.map((e) => [e.id, e.schedule?.start]));
    const MAP = { ON_TIME: 'came', LATE: 'late', ABSENT: 'absent', DAY_OFF: 'off' } as const;
    const records: FaceRecord[] = parts.flatMap((p) =>
      p.items.map((r) => {
        const inT = hhmm(r.firstIn);
        const outT = hhmm(r.lastOut);
        const status: FaceStatus = MAP[r.status] ?? 'came';
        return {
          employeeId: r.employeeId,
          date: r.date,
          status,
          ...(inT ? { in: inT } : {}),
          ...(outT ? { out: outT } : {}),
          ...(status === 'late' && r.lateMinutes ? { late: r.lateMinutes } : {}),
          ...(status === 'came' ? { early: this.early(inT, start.get(r.employeeId)) } : {}),
          ...(r.workedMinutes ? { worked: r.workedMinutes } : {}),
        };
      }),
    );
    return { from, to, records, notes };
  }

  async events(date: string) {
    const res = await this.client.get<UEvents>('attendance/events', { date, limit: 500 }, date === todayTashkent() ? 15_000 : 10 * 60_000);
    return res.items
      .filter((e) => e.employeeId && (e.kind === 'in' || e.kind === 'out'))
      .map((e) => ({ id: e.id, employeeId: e.employeeId as string, kind: e.kind as 'in' | 'out', time: hhmm(e.at) ?? '', branchId: e.branch.id }));
  }

  // ---------- notes ----------
  private async notesFor(from: string, to: string): Promise<Record<string, FaceNote>> {
    const rows = await this.prisma.faceidNote.findMany({ where: { date: { gte: from, lte: to } } });
    return Object.fromEntries(rows.map((r) => [`${r.employeeId}|${r.date}`, { reason: r.reason, note: r.note }]));
  }

  async saveNote(actorId: string, dto: { employeeId: string; date: string; reason?: string | null; note?: string | null }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dto.date)) throw new AppError('VALIDATION_ERROR', { reason: 'bad_date' });
    const reason = dto.reason && (REASONS as readonly string[]).includes(dto.reason) ? dto.reason : null;
    const note = dto.note?.trim().slice(0, 300) || null;
    const where = { employeeId_date: { employeeId: dto.employeeId, date: dto.date } };
    const before = await this.prisma.faceidNote.findUnique({ where });
    if (!reason && !note) {
      if (before) await this.prisma.faceidNote.delete({ where });
    } else {
      await this.prisma.faceidNote.upsert({
        where,
        create: { employeeId: dto.employeeId, date: dto.date, reason, note, updatedBy: actorId },
        update: { reason, note, updatedBy: actorId },
      });
    }
    await this.audit.record({
      actorId,
      action: 'faceid.note',
      entityType: 'faceid_note',
      entityId: `${dto.employeeId}|${dto.date}`,
      before: before ? { reason: before.reason, note: before.note } : undefined,
      after: { reason, note },
    });
    return { reason, note };
  }
}
