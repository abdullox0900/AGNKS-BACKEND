import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../roles.guard';

function ctx(method: string, actor: unknown, roles?: string[]) {
  const handler = () => undefined;
  class Cls {}
  if (roles) Reflect.defineMetadata('roles', roles, handler);
  return {
    switchToHttp: () => ({ getRequest: () => ({ method, actor }) }),
    getHandler: () => handler,
    getClass: () => Cls,
  } as never;
}
const staff = (role: string) => ({ kind: 'staff', userId: 'u', role, stationId: null, terminalIds: [] });
const ALL = ['branch_manager', 'root_admin', 'seo'];

describe('RolesGuard — root_admin is read-only', () => {
  const guard = new RolesGuard(new Reflector());

  it.each(['GET', 'HEAD', 'OPTIONS'])('lets root_admin %s', (m) => {
    expect(guard.canActivate(ctx(m, staff('root_admin'), ALL))).toBe(true);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('rejects root_admin %s with read_only_role', (m) => {
    expect(() => guard.canActivate(ctx(m, staff('root_admin'), ALL))).toThrow(
      expect.objectContaining({ code: 'AUTH_FORBIDDEN', details: { reason: 'read_only_role' } }),
    );
  });

  it.each(['seo', 'branch_manager'])('still lets %s write where the route allows it', (role) => {
    expect(guard.canActivate(ctx('POST', staff(role), ALL))).toBe(true);
  });

  it('still enforces the @Roles list for everybody else', () => {
    expect(() => guard.canActivate(ctx('GET', staff('cashier'), ALL))).toThrow();
    expect(() => guard.canActivate(ctx('POST', staff('branch_manager'), ['root_admin', 'seo']))).toThrow();
  });
});
