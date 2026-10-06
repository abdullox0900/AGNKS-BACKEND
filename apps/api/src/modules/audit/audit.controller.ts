import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Roles } from '@/common/decorators/roles.decorator';
import { RolesGuard } from '@/common/guards/roles.guard';
import { StaffAuthGuard } from '@/common/guards/staff-auth.guard';
import { AuditService } from './audit.service';

/** "Who changed what" — the dashboard action history. Visible to SEO and (view-only) root_admin. */
@Controller('admin/audit')
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('root_admin', 'seo')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(
    @Query('actor') actor?: string,
    @Query('group') group?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.audit.list({ actor, group, from, to, cursor, limit: Math.min(Math.max(Number(limit) || 30, 1), 100) });
  }

  /** People who have at least one entry — fills the "who" filter. */
  @Get('actors')
  actors() {
    return this.audit.actors();
  }
}
