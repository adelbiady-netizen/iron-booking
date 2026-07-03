import type { UserRole } from '../types';

// UX-only mirror of the backend management.access capability. Decides whether to
// SHOW the "Management Center / מרכז הניהול" entry in the Host Workspace. The
// backend /management/context endpoint is the authoritative gate — this only
// avoids rendering an entry the user can't use.
//
// P0.1: owner tier only (RESTAURANT_ADMIN/OWNER/ADMIN, plus HQ tiers which bypass).
// MANAGER gains access via a per-user grant in Mission P0.9 (Admin › Roles).
const ENTRY_ROLES: UserRole[] = [
  'OWNER',
  'ADMIN',
  'RESTAURANT_ADMIN',
  'SUPER_ADMIN',
  'HQ_ADMIN',
];

export function canSeeManagementEntry(role: UserRole): boolean {
  return ENTRY_ROLES.includes(role);
}
