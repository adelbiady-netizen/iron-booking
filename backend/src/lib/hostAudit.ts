import { prisma } from './prisma';
import { Prisma } from '@prisma/client';
import type { AuthPayload } from '../middleware/auth';

/**
 * Append-only audit for operational changes made from the Host application
 * (team management, online-reservation controls). Reuses the existing
 * `host_events` table — no new schema. Every entry records the acting user,
 * a timestamp (createdAt), and the before/new values carried in `properties`.
 *
 * Fire-and-forget: an audit-write failure must NEVER block or fail the action
 * the manager just performed. Errors are logged and swallowed.
 */
export function writeHostAudit(
  auth: AuthPayload,
  event: string,
  properties: Record<string, unknown>,
): void {
  prisma.hostEvent
    .create({
      data: {
        restaurantId: auth.restaurantId,
        hostName: `${auth.firstName} ${auth.lastName}`.trim() || auth.email,
        event,
        properties: {
          actorId: auth.userId,
          actorRole: auth.role,
          ...properties,
        } as Prisma.InputJsonValue,
      },
    })
    .catch((err) => {
      console.error(
        '[hostAudit] write failed — change was applied but not audited:',
        err instanceof Error ? err.message : err,
        { event, restaurantId: auth.restaurantId },
      );
    });
}
