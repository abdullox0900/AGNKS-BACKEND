import { updateProfileSchema } from '@agnks/types';
import { DashboardAuthService } from '../dashboard-auth.service';

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';

function setup(profile: { bio: string | null; avatar: string | null } | null = null, firstName = 'Ali') {
  const tx = {
    user: { update: jest.fn() },
    staffProfile: { upsert: jest.fn() },
  };
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', firstName, profile }) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<void>) => fn(tx)),
  };
  const service = new DashboardAuthService(prisma as never, {} as never, {} as never);
  return { service, tx, prisma };
}

describe('updateProfileSchema', () => {
  it('accepts a name, an about-me text and a small image', () => {
    expect(updateProfileSchema.safeParse({ firstName: 'Abdulloh', bio: 'SEO', avatar: JPEG }).success).toBe(true);
  });
  it('lets the avatar and bio be cleared with null', () => {
    expect(updateProfileSchema.safeParse({ avatar: null }).success).toBe(true);
    expect(updateProfileSchema.safeParse({ bio: null }).success).toBe(true);
  });
  it('rejects an empty update, a one-letter name, a long bio and a non-image / oversized avatar', () => {
    expect(updateProfileSchema.safeParse({}).success).toBe(false);
    expect(updateProfileSchema.safeParse({ firstName: 'A' }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ bio: 'x'.repeat(301) }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ avatar: 'data:text/html;base64,PHNjcmlwdD4=' }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ avatar: 'https://evil.example/a.png' }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ avatar: `data:image/png;base64,${'A'.repeat(80_001)}` }).success).toBe(false);
  });
});

describe('DashboardAuthService.updateProfile', () => {
  it('changes only what was sent and says what changed', async () => {
    const { service, tx } = setup({ bio: 'old', avatar: null });
    const res = await service.updateProfile('u1', { bio: 'new about me' });
    expect(res.changed).toEqual(['bio']);
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.staffProfile.upsert).toHaveBeenCalledWith({ where: { userId: 'u1' }, create: { userId: 'u1', bio: 'new about me' }, update: { bio: 'new about me' } });
  });

  it('renames the user and stores the avatar in the profile row', async () => {
    const { service, tx } = setup(null, 'Ali');
    const res = await service.updateProfile('u1', { firstName: 'Abdulloh', avatar: JPEG });
    expect(res.changed).toEqual(['firstName', 'avatar']);
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { firstName: 'Abdulloh' } });
    expect(tx.staffProfile.upsert).toHaveBeenCalledWith({ where: { userId: 'u1' }, create: { userId: 'u1', avatar: JPEG }, update: { avatar: JPEG } });
  });

  it('removes the avatar with null', async () => {
    const { service, tx } = setup({ bio: null, avatar: JPEG });
    const res = await service.updateProfile('u1', { avatar: null });
    expect(res.changed).toEqual(['avatar']);
    expect(tx.staffProfile.upsert).toHaveBeenCalledWith({ where: { userId: 'u1' }, create: { userId: 'u1', avatar: null }, update: { avatar: null } });
  });

  it('writes nothing when nothing actually changed', async () => {
    const { service, prisma } = setup({ bio: 'same', avatar: JPEG }, 'Ali');
    const res = await service.updateProfile('u1', { firstName: 'Ali', bio: 'same', avatar: JPEG });
    expect(res.changed).toEqual([]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('treats an empty bio as cleared', async () => {
    const { service, tx } = setup({ bio: 'old', avatar: null });
    const res = await service.updateProfile('u1', { bio: '' });
    expect(res.changed).toEqual(['bio']);
    expect(tx.staffProfile.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { bio: null } }));
  });
});
