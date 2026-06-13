import { Router, Request } from 'express';
import { authenticate } from '../../middleware/auth';
import * as svc from './service';

const router = Router({ mergeParams: true });

router.use(authenticate);

// mergeParams injects restaurantId from the parent route — cast to access it
function rid(req: Request): string {
  return (req.params as Record<string, string>)['restaurantId'] ?? '';
}

// GET /restaurants/:restaurantId/intelligence/guests/:guestId
router.get('/guests/:guestId', async (req, res) => {
  try {
    const data = await svc.getGuestIntelligence(rid(req), req.params.guestId);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /restaurants/:restaurantId/intelligence/guests/:guestId/refresh
router.post('/guests/:guestId/refresh', async (req, res) => {
  try {
    const data = await svc.refreshGuestIntelligence(rid(req), req.params.guestId);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /restaurants/:restaurantId/intelligence/guests/:guestId/memories
router.post('/guests/:guestId/memories', async (req, res) => {
  try {
    const memory = await svc.addMemory(rid(req), req.params.guestId, req.body as Parameters<typeof svc.addMemory>[2]);
    res.status(201).json(memory);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /restaurants/:restaurantId/intelligence/alerts/:alertId
router.delete('/alerts/:alertId', async (req, res) => {
  try {
    await svc.dismissAlert(rid(req), req.params.alertId);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /restaurants/:restaurantId/intelligence/guests/:guestId/recovery
router.post('/guests/:guestId/recovery', async (req, res) => {
  try {
    const recoveryCase = await svc.createRecoveryCase(rid(req), req.params.guestId, req.body as Parameters<typeof svc.createRecoveryCase>[2]);
    res.status(201).json(recoveryCase);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /restaurants/:restaurantId/intelligence/recovery/:caseId/actions
router.post('/recovery/:caseId/actions', async (req, res) => {
  try {
    const action = await svc.addRecoveryAction(rid(req), req.params.caseId, req.body as Parameters<typeof svc.addRecoveryAction>[2]);
    res.status(201).json(action);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /restaurants/:restaurantId/intelligence/recovery/:caseId/resolve
router.post('/recovery/:caseId/resolve', async (req, res) => {
  try {
    const updated = await svc.resolveRecoveryCase(rid(req), req.params.caseId);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /restaurants/:restaurantId/intelligence/moments?status=PENDING|APPROVED|SENT
router.get('/moments', async (req, res) => {
  try {
    const status = req.query['status'] as string | undefined;
    const moments = await svc.getMoments(rid(req), status);
    res.json(moments);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /restaurants/:restaurantId/intelligence/moments/:momentId/review
router.post('/moments/:momentId/review', async (req, res) => {
  try {
    const updated = await svc.reviewMoment(rid(req), req.params.momentId, req.body as Parameters<typeof svc.reviewMoment>[2]);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /restaurants/:restaurantId/intelligence/morning-brief
router.get('/morning-brief', async (req, res) => {
  try {
    const brief = await svc.getMorningBrief(rid(req), req.query['date'] as string | undefined);
    if (!brief) return res.status(404).json({ error: 'No brief yet' });
    res.json(brief);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
