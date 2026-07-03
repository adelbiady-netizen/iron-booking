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
import { capabilitiesFor, toProductRole, type Capability, type ProductRole } from '../../lib/capabilities';

export interface ManagementContext {
  role: UserRole;
  productRole: ProductRole;
  restaurantId: string;
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
  role: UserRole;
  restaurantId: string;
}): Promise<ManagementContext> {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: auth.restaurantId },
    select: { id: true, name: true, slug: true, timezone: true, settings: true },
  });
  if (!restaurant) throw new NotFoundError('Restaurant', auth.restaurantId);

  return {
    role: auth.role,
    productRole: toProductRole(auth.role),
    restaurantId: auth.restaurantId,
    restaurant,
    capabilities: capabilitiesFor(auth.role),
  };
}
