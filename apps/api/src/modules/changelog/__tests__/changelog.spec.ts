import { createChangelogSchema, updateChangelogSchema } from '@agnks/types';
import { ChangelogService } from '../changelog.service';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

function setup(existing: Record<string, unknown> | null = null) {
  const created = { id: 'p1', title: 'T', version: null };
  const prisma = {
    changelogPost: {
      create: jest.fn().mockResolvedValue(created),
      findUnique: jest.fn().mockResolvedValue(existing),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
      findMany: jest.fn(),
    },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'u1', firstName: 'Abdulloh' }]) },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  return { service: new ChangelogService(prisma as never, audit as never), prisma, audit };
}

describe('changelog schemas', () => {
  it('accepts a post with a version, link and picture', () => {
    expect(createChangelogSchema.safeParse({ title: 'Profil', body: 'Endi profil bor', version: '1.4', linkUrl: 'https://metango.uz/x', linkLabel: 'Batafsil', image: PNG }).success).toBe(true);
  });
  it('needs a title and a body; link must be http(s); picture must be an image data URL', () => {
    expect(createChangelogSchema.safeParse({ title: 'A', body: 'x' }).success).toBe(false);
    expect(createChangelogSchema.safeParse({ title: 'Ok title', body: '' }).success).toBe(false);
    expect(createChangelogSchema.safeParse({ title: 'Ok title', body: 'x', linkUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(createChangelogSchema.safeParse({ title: 'Ok title', body: 'x', linkUrl: 'ftp://x.uz' }).success).toBe(false);
    expect(createChangelogSchema.safeParse({ title: 'Ok title', body: 'x', image: 'data:text/html;base64,AAAA' }).success).toBe(false);
    expect(createChangelogSchema.safeParse({ title: 'Ok title', body: 'x', image: `data:image/png;base64,${'A'.repeat(200_001)}` }).success).toBe(false);
  });
  it('an update may send any subset but not nothing', () => {
    expect(updateChangelogSchema.safeParse({ body: 'yangi matn' }).success).toBe(true);
    expect(updateChangelogSchema.safeParse({ image: null }).success).toBe(true);
    expect(updateChangelogSchema.safeParse({}).success).toBe(false);
  });
});

describe('ChangelogService', () => {
  it('creates a post under the author and logs it', async () => {
    const { service, prisma, audit } = setup();
    await service.create({ title: 'Profil qo‘shildi', body: 'Matn', version: ' 1.4 ', linkUrl: '', linkLabel: null }, 'u1');
    expect(prisma.changelogPost.create).toHaveBeenCalledWith({
      data: { title: 'Profil qo‘shildi', body: 'Matn', version: '1.4', linkUrl: null, linkLabel: null, image: null, createdBy: 'u1' },
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'news.create', actorId: 'u1' }));
  });

  it('updates only the sent fields and never puts the picture into the audit entry', async () => {
    const { service, prisma, audit } = setup({ id: 'p1', title: 'Old', version: '1.0' });
    await service.update('p1', { body: 'new', image: PNG }, 'u1');
    expect(prisma.changelogPost.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { body: 'new', image: PNG } });
    const entry = audit.record.mock.calls[0][0];
    expect(JSON.stringify(entry)).not.toContain('iVBOR');
    expect(entry.after.image).toBe('yangilandi');
  });

  it('removes a post, and reports a missing one', async () => {
    const found = setup({ id: 'p1', title: 'Old', version: null });
    await found.service.remove('p1', 'u1');
    expect(found.prisma.changelogPost.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
    const missing = setup(null);
    await expect(missing.service.remove('nope', 'u1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(missing.service.update('nope', { body: 'x' }, 'u1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lists light rows (no text, no picture) newest first with author names and a cursor when there is more', async () => {
    const { service, prisma } = setup();
    const row = (i: number) => ({ id: `p${i}`, title: `T${i}`, version: null, createdBy: 'u1', createdAt: new Date(2026, 9, 20 - i) });
    prisma.changelogPost.findMany.mockResolvedValue(Array.from({ length: 31 }, (_, i) => row(i)));
    const res = await service.list();
    expect(res.items).toHaveLength(30);
    expect(res.items[0]).toEqual({ id: 'p0', title: 'T0', version: null, authorId: 'u1', authorName: 'Abdulloh', createdAt: new Date(2026, 9, 20).toISOString() });
    expect(res.items[0]).not.toHaveProperty('body');
    expect(res.items[0]).not.toHaveProperty('image');
    expect(res.nextCursor).toBe('p29');
    expect(prisma.changelogPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 31, select: { id: true, title: true, version: true, createdBy: true, createdAt: true } }),
    );
  });

  it('returns a whole post by id, or NOT_FOUND', async () => {
    const full = { id: 'p1', title: 'T', body: 'Matn', version: '1.5', linkUrl: 'https://metango.uz', linkLabel: null, image: PNG, createdBy: 'u1', createdAt: new Date(2026, 9, 12), updatedAt: new Date(2026, 9, 12) };
    const found = setup(full);
    expect(await found.service.get('p1')).toMatchObject({ id: 'p1', body: 'Matn', image: PNG, linkUrl: 'https://metango.uz', authorName: 'Abdulloh' });
    await expect(setup(null).service.get('nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
