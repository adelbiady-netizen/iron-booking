import { Router, Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { validateToken, consumeToken } from '../../lib/unsubscribeToken';
import { writeConsentAudit, ConsentType, ConsentAction, ConsentSource } from '../../lib/consentAudit';

const router = Router();

/**
 * GET /api/public/unsubscribe/:token
 *
 * One-click unsubscribe — no login required.
 * Returns JSON so the frontend page can display the correct Hebrew state.
 *
 * Response shape:
 *   { status: 'ok' | 'already_used' | 'expired' | 'invalid' }
 */
router.get('/:token', async (req: Request, res: Response) => {
  const token = req.params['token'] as string;

  // 1. Validate token (read-only — does not modify the row)
  const validated = await validateToken(token);

  if (validated.status === 'already_used') {
    return res.json({ status: 'already_used' });
  }
  if (validated.status === 'expired') {
    return res.json({ status: 'expired' });
  }
  if (validated.status === 'invalid') {
    return res.json({ status: 'invalid' });
  }

  // 2. Apply unsubscribe — smsConsent=false, marketingConsent=false
  const { tokenId, restaurantId, guestId, clubMemberId } = validated;

  try {
    await prisma.$transaction(async (tx) => {
      // Update ClubMember consent flags if member exists
      if (clubMemberId) {
        await tx.clubMember.update({
          where: { id: clubMemberId },
          data:  { smsConsent: false, marketingConsent: false },
        });
      } else {
        // No club member — update all active club memberships for this guest at this restaurant
        await tx.clubMember.updateMany({
          where: { restaurantId: restaurantId!, guestId: guestId!, status: 'ACTIVE' },
          data:  { smsConsent: false, marketingConsent: false },
        });
      }

      // Mark token consumed inside the same transaction
      await tx.unsubscribeToken.update({
        where: { id: tokenId! },
        data:  { usedAt: new Date() },
      });
    });

    // 3. Immutable audit row — outside transaction so it never blocks the unsubscribe
    void writeConsentAudit({
      restaurantId:    restaurantId!,
      guestId:         guestId!,
      clubMemberId:    clubMemberId ?? null,
      consentType:     ConsentType.SMS_MARKETING,
      action:          ConsentAction.REVOKED,
      source:          ConsentSource.UNSUBSCRIBE_LINK,
      smsConsent:      false,
      marketingConsent: false,
      ipAddress:       req.ip ?? null,
      userAgent:       req.headers['user-agent'] ?? null,
      actorId:         null, // guest self-service
      notes:           `unsubscribe token ${tokenId} consumed`,
    });

    return res.json({ status: 'ok' });
  } catch (err) {
    console.error('[unsubscribe] Transaction failed:', err instanceof Error ? err.message : err);
    return res.status(500).json({ status: 'error', message: 'שגיאה פנימית — נסה שוב מאוחר יותר' });
  }
});

export default router;
