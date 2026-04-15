import { Router, Request, Response } from 'express';
import { ReservationService } from '../services/reservation/ReservationService';

const reservationRouter = Router();
const reservationService = new ReservationService();

reservationRouter.post('/', async (req: Request, res: Response) => {
  try {
    console.log('Incoming reservation request body:', req.body);

    const result = await reservationService.create(req.body);

    return res.status(201).json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error('Reservation route error:', error);

    return res.status(400).json({
      error: {
        code: error.code || 'RESERVATION_CREATE_FAILED',
        message: error.message || 'Failed to create reservation',
      },
    });
  }
});

export default reservationRouter;