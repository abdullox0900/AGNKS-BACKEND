import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { createChangelogSchema, updateChangelogSchema, type CreateChangelogDto, type UpdateChangelogDto } from '@agnks/types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { StaffAuthGuard } from '@/common/guards/staff-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentStaff } from '@/common/decorators/current-actor.decorator';
import type { StaffActor } from '@/common/types/actor';
import { ChangelogService } from './changelog.service';

/** Everyone on the dashboard reads; only the SEO writes (root_admin is view-only anyway). */
@Controller('admin/changelog')
@UseGuards(StaffAuthGuard, RolesGuard)
export class ChangelogController {
  constructor(private readonly changelog: ChangelogService) {}

  @Get()
  @Roles('branch_manager', 'root_admin', 'seo')
  list(@Query('cursor') cursor?: string) {
    return this.changelog.list(cursor);
  }

  @Get(':id')
  @Roles('branch_manager', 'root_admin', 'seo')
  get(@Param('id') id: string) {
    return this.changelog.get(id);
  }

  @Post()
  @Roles('seo')
  create(@Body(new ZodValidationPipe(createChangelogSchema)) dto: CreateChangelogDto, @CurrentStaff() actor: StaffActor) {
    return this.changelog.create(dto, actor.userId);
  }

  @Patch(':id')
  @Roles('seo')
  update(@Param('id') id: string, @Body(new ZodValidationPipe(updateChangelogSchema)) dto: UpdateChangelogDto, @CurrentStaff() actor: StaffActor) {
    return this.changelog.update(id, dto, actor.userId);
  }

  @Delete(':id')
  @Roles('seo')
  remove(@Param('id') id: string, @CurrentStaff() actor: StaffActor) {
    return this.changelog.remove(id, actor.userId);
  }
}
