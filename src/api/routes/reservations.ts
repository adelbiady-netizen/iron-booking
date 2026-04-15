import { Router, Request, Response, NextFunction } from 'express';
import { ReservationService } from '../../services/reservation/ReservationService';

const router = Router();
const reservationService = new ReservationService();

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    console.log('\n[ROUTE] POST /api/v1/reservations');
    console.log('[ROUTE] body:', JSON.stringify(req.body, null, 2));

    const result = await reservationService.create(req.body);

    return res.status(201).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

export default router;