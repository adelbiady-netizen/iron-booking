/**
 * Management Workspace context service (Mission P0.1).
 *
 * Returns "who am I, what can I do, which restaurant am I in" for the current
 * user's OWN restaurant. This is the single read the workspace shell needs to
 * boot — it does not touch the HQ admin router.
 */

import type { UserRole } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { NotFoundError } from '../../lib/errors';
import { capabilitiesForUser, toProductRole, type Capability, type ProductRole } from '../../lib/capabilities';

export interface ManagementContext {
  role: UserRole;
  productRole: ProductRole;
  restaurantId: string;
  managementAccess: boolean;
  restaurant: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
    settings: unknown;
  };
  capabilities: Capability[];
}

export async function buildManagementContext(auth: {
  userId: string;
  role: UserRole;
  restaurantId: string;
}): Promise<ManagementContext> {
  const [restaurant, user] = await Promise.all([
    prisma.restaurant.findUnique({
      where: { id: auth.restaurantId },
      select: { id: true, name: true, slug: true, timezone: true, settings: true },
    }),
    prisma.user.findUnique({ where: { id: auth.userId }, select: { managementAccess: true } }),
  ]);
  if (!restaurant) throw new NotFoundError('Restaurant', auth.restaurantId);

  const managementAccess = user?.managementAccess ?? false;
  return {
    role: auth.role,
    productRole: toProductRole(auth.role),
    restaurantId: auth.restaurantId,
    managementAccess,
    restaurant,
    capabilities: capabilitiesForUser(auth.role, managementAccess),
  };
}
