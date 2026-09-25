import { SetMetadata } from '@nestjs/common';
import type { StaffRole } from '@agnks/types';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: StaffRole[]): ReturnType<typeof SetMetadata> => SetMetadata(ROLES_KEY, roles);
