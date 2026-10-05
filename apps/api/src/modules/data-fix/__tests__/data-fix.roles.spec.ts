import { DataFixController } from '../data-fix.controller';

describe('data correction is SEO-only', () => {
  it('every route needs the seo role (root_admin and branch managers are out; root_admin is also read-only)', () => {
    expect(Reflect.getMetadata('roles', DataFixController)).toEqual(['seo']);
  });
});
