import { prisma } from './prisma';
import { ConsentType, ConsentAction, ConsentSource } from '@prisma/client';

export { ConsentType, ConsentAction, ConsentSource };

export interface ConsentAuditParams {
  restaurantId:        string;
  guestId:             string;
  clubMemberId?:       string | null;
  consentType:         ConsentType;
  action:              ConsentAction;
  source:              ConsentSource;
  // Snapshot of consent values at the moment of the change
  smsConsent?:         boolean | null;
  marketingConsent?:   boolean | null;
  emailConsent?:       boolean | null;
  // Legal evidence
  consentTextVersion?: string | null;
  ipAddress?:          string | null;
  userAgent?:          string | null;
  // Human context
  actorId?:            string | null; // userId of staff member; null = guest self-service
  notes?:              string | null;
}

/**
 * Append-only consent audit entry.
 * NEVER call prisma.consentAudit.update/delete — rows are immutable by design.
 * Swallows errors with a warning so a consent-audit failure never blocks a user action.
 */
export async function writeConsentAudit(params: ConsentAuditParams): Promise<void> {
  try {
    await prisma.consentAudit.create({ data: params });
  } catch (err) {
    // Audit failure must not surface to the caller — log and continue.
    console.error(
      '[consentAudit] Failed to write audit row — consent change was applied but not audited:',
      err instanceof Error ? err.message : err,
      { restaurantId: params.restaurantId, guestId: params.guestId, consentType: params.consentType },
    );
  }
}

/**
 * Helper: derive ConsentAction from old vs new boolean values.
 * - null/undefined old → GRANTED (first time)
 * - true → false       → REVOKED
 * - false → true       → GRANTED
 * - same value         → UPDATED (used when other fields changed alongside)
 */
export function deriveAction(
  oldValue: boolean | null | undefined,
  newValue: boolean,
): ConsentAction {
  if (oldValue === null || oldValue === undefined) return ConsentAction.GRANTED;
  if (!oldValue && newValue)  return ConsentAction.GRANTED;
  if (oldValue  && !newValue) return ConsentAction.REVOKED;
  return ConsentAction.UPDATED;
}
