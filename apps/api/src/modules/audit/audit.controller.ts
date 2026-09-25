import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Roles } from '@/common/decorators/roles.decorator';
import { RolesGuard } from '@/common/guards/roles.guard';
import { StaffAuthGuard } from '@/common/guards/staff-auth.guard';
import { PrismaService } from '@/infra/prisma/prisma.service';

@Controller('admin/audit')
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('root_admin', 'seo')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @Query('actor') actor?: string,
    @Query('entity') entity?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit = '20',
  ) {
    const take = Math.min(Number(limit) || 20, 100);
    const items = await this.prisma.auditLog.findMany({
      where: {
        actorId: actor,
        entityType: entity,
        createdAt: { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined },
      },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = items.length > take;
    const page = hasMore ? items.slice(0, take) : items;
    return { items: page, nextCursor: hasMore ? page[page.length - 1].id : null };
  }
}
