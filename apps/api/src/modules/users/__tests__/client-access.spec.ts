import { AdminClientsController } from '../admin-clients.controller';
import { AdminClientReceiptController } from '../../receipts/admin-client-receipt.controller';

const rolesOf = (target: object) => Reflect.getMetadata('roles', target) as string[];

describe('client pages are closed to the view-only root_admin', () => {
  const proto = AdminClientsController.prototype;

  it('the list stays visible (search by name / phone)', () => {
    expect(rolesOf(proto.search)).toContain('root_admin');
  });

  it.each(['detail', 'history'] as const)('%s is not available to root_admin, but is to seo and branch_manager', (m) => {
    const roles = rolesOf(proto[m]);
    expect(roles).not.toContain('root_admin');
    expect(roles).toEqual(expect.arrayContaining(['seo', 'branch_manager']));
  });

  it('a single receipt of a client is not available to root_admin either', () => {
    expect(rolesOf(AdminClientReceiptController)).not.toContain('root_admin');
  });
});
