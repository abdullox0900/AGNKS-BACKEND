import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '@agnks/types';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AuditService } from '@/modules/audit/audit.service';

@Injectable()
export class StationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  listActive() {
    return this.prisma.station.findMany({ where: { status: 'active' }, orderBy: { name: 'asc' } });
  }

  listAll() {
    return this.prisma.station.findMany({ orderBy: { name: 'asc' } });
  }

  async create(input: { name: string; address: string; lat: number; lng: number; radiusM: number }, actorId: string) {
    const station = await this.prisma.station.create({ data: input });
    await this.audit.record({ actorId, action: 'station.create', entityType: 'station', entityId: station.id, after: station });
    return station;
  }

  async update(id: string, input: Partial<{ name: string; address: string; lat: number; lng: number; radiusM: number; status: 'active' | 'paused' | 'closed' }>, actorId: string) {
    const before = await this.prisma.station.findUnique({ where: { id } });
    if (!before) throw new AppError('NOT_FOUND');

    const station = await this.prisma.station.update({ where: { id }, data: input });
    await this.audit.record({ actorId, action: 'station.update', entityType: 'station', entityId: id, before, after: station });
    return station;
  }

  /** Real deletion (not a status change) — only possible while the station has never
   * had any receipts/shifts/spend operations, since those reference it without cascade.
   * A station with history should be closed via `update({status: 'closed'})` instead. */
  async remove(id: string, actorId: string) {
    const before = await this.prisma.station.findUnique({ where: { id } });
    if (!before) throw new AppError('NOT_FOUND');

    try {
      await this.prisma.$transaction([
        this.prisma.terminal.deleteMany({ where: { stationId: id } }),
        this.prisma.station.delete({ where: { id } }),
      ]);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new AppError('VALIDATION_ERROR', {
          message: "Bu filialda cheklar yoki smenalar mavjud — o'chirib bo'lmaydi, buning o'rniga yopish (status) dan foydalaning",
        });
      }
      throw err;
    }

    await this.audit.record({ actorId, action: 'station.delete', entityType: 'station', entityId: id, before });
    return { success: true };
  }

  async listTerminals(stationId: string) {
    return this.prisma.terminal.findMany({ where: { stationId } });
  }

  async createTerminal(stationId: string, input: { code: string; label: string }, actorId: string) {
    const station = await this.prisma.station.findUnique({ where: { id: stationId } });
    if (!station) throw new AppError('NOT_FOUND');

    const terminal = await this.prisma.terminal.create({ data: { stationId, ...input } });
    await this.audit.record({ actorId, action: 'terminal.create', entityType: 'terminal', entityId: terminal.id, after: terminal });
    return terminal;
  }

  async updateTerminal(id: string, input: Partial<{ code: string; label: string; active: boolean }>, actorId: string) {
    const before = await this.prisma.terminal.findUnique({ where: { id } });
    if (!before) throw new AppError('NOT_FOUND');

    if (input.code && input.code !== before.code) {
      const clash = await this.prisma.terminal.findUnique({ where: { code: input.code } });
      if (clash) throw new AppError('VALIDATION_ERROR', { message: "Bu terminal kodi allaqachon ishlatilmoqda" });
    }

    const terminal = await this.prisma.terminal.update({ where: { id }, data: input });
    await this.audit.record({ actorId, action: 'terminal.update', entityType: 'terminal', entityId: id, before, after: terminal });
    return terminal;
  }

  async findTerminalByCode(code: string) {
    return this.prisma.terminal.findUnique({ where: { code }, include: { station: true } });
  }
}
