import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/infra/prisma/prisma.service';

export interface AuditEntry {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Never allowed to break the caller's transaction — audit is best-effort observability. */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: entry.actorId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          before: (entry.before ?? undefined) as object | undefined,
          after: (entry.after ?? undefined) as object | undefined,
          ip: entry.ip ?? null,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to write audit log for ${entry.action}: ${(err as Error).message}`);
    }
  }
}
