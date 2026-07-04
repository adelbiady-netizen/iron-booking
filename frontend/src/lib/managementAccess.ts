import type { UserRole } from '../types';

// UX mirror of the backend Management Center gate. Decides whether to SHOW the
// "מרכז הניהול" entry in the Host Workspace. The /management/context endpoint is
// the authoritative gate — this only avoids rendering an entry the user can't use.
//
// Rules (match backend canAccessManagement):
// - HQ + owner tier (SUPER_ADMIN/HQ_ADMIN/GROUP_MANAGER/RESTAURANT_ADMIN/OWNER/ADMIN) → always
// - MANAGER → only when granted (User.managementAccess === true)
// - HOST/SERVER → never
const ALWAYS_ACCESS: UserRole[] = [
  'SUPER_ADMIN', 'HQ_ADMIN', 'GROUP_MANAGER', 'RESTAURANT_ADMIN', 'OWNER', 'ADMIN',
];

export function canSeeManagementEntry(user: { role: UserRole; managementAccess?: boolean }): boolean {
  if (ALWAYS_ACCESS.includes(user.role)) return true;
  if (user.role === 'MANAGER') return user.managementAccess === true;
  return false;
}
