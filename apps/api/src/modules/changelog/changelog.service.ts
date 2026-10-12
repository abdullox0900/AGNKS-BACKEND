import { Injectable } from '@nestjs/common';
import { AppError, type CreateChangelogDto, type UpdateChangelogDto } from '@agnks/types';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AuditService } from '@/modules/audit/audit.service';

const PAGE = 30;
const clean = (v: string | null | undefined) => (v ? v.trim() || null : null);

/** "Yangilanishlar": release notes the SEO writes and every dashboard user reads, newest first. */
@Injectable()
export class ChangelogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Light rows for the list (title, version, date, author) — the text and the picture only come with `get`. */
  async list(cursor?: string) {
    const rows = await this.prisma.changelogPost.findMany({
      select: { id: true, title: true, version: true, createdBy: true, createdAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > PAGE;
    const page = hasMore ? rows.slice(0, PAGE) : rows;
    const names = await this.authorNames(page.map((r) => r.createdBy));
    return {
      items: page.map((r) => ({
        id: r.id,
        title: r.title,
        version: r.version,
        authorId: r.createdBy,
        authorName: names.get(r.createdBy) ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  /** One whole post: text, link and picture. */
  async get(id: string) {
    const r = await this.prisma.changelogPost.findUnique({ where: { id } });
    if (!r) throw new AppError('NOT_FOUND');
    const names = await this.authorNames([r.createdBy]);
    return {
      id: r.id,
      title: r.title,
      body: r.body,
      version: r.version,
      linkUrl: r.linkUrl,
      linkLabel: r.linkLabel,
      image: r.image,
      authorId: r.createdBy,
      authorName: names.get(r.createdBy) ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private async authorNames(ids: string[]) {
    const authors = await this.prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, firstName: true } });
    return new Map(authors.map((a) => [a.id, a.firstName]));
  }

  async create(dto: CreateChangelogDto, actorId: string) {
    const row = await this.prisma.changelogPost.create({
      data: {
        title: dto.title,
        body: dto.body,
        version: clean(dto.version),
        linkUrl: clean(dto.linkUrl),
        linkLabel: clean(dto.linkLabel),
        image: dto.image ?? null,
        createdBy: actorId,
      },
    });
    await this.audit.record({ actorId, action: 'news.create', entityType: 'changelog', entityId: row.id, after: { title: row.title, version: row.version } });
    return { id: row.id };
  }

  async update(id: string, dto: UpdateChangelogDto, actorId: string) {
    const before = await this.prisma.changelogPost.findUnique({ where: { id } });
    if (!before) throw new AppError('NOT_FOUND');
    const data = {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.body !== undefined ? { body: dto.body } : {}),
      ...(dto.version !== undefined ? { version: clean(dto.version) } : {}),
      ...(dto.linkUrl !== undefined ? { linkUrl: clean(dto.linkUrl) } : {}),
      ...(dto.linkLabel !== undefined ? { linkLabel: clean(dto.linkLabel) } : {}),
      ...(dto.image !== undefined ? { image: dto.image } : {}),
    };
    await this.prisma.changelogPost.update({ where: { id }, data });
    await this.audit.record({
      actorId,
      action: 'news.update',
      entityType: 'changelog',
      entityId: id,
      before: { title: before.title, version: before.version },
      after: { title: dto.title ?? before.title, version: dto.version === undefined ? before.version : clean(dto.version), ...(dto.image !== undefined ? { image: dto.image ? 'yangilandi' : "o'chirildi" } : {}) },
    });
    return { id };
  }

  async remove(id: string, actorId: string) {
    const before = await this.prisma.changelogPost.findUnique({ where: { id } });
    if (!before) throw new AppError('NOT_FOUND');
    await this.prisma.changelogPost.delete({ where: { id } });
    await this.audit.record({ actorId, action: 'news.delete', entityType: 'changelog', entityId: id, before: { title: before.title, version: before.version } });
    return { id };
  }
}
