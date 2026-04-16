import { Router } from "express";
import updateReservation from "../controllers/updateReservation";
import {
  createReservation,
  getReservations,
  getReservationById,
  seatReservation,
} from "../controllers/ReservationController";

const router = Router();

router.get("/", getReservations);
router.get("/:id", getReservationById);
router.post("/", createReservation);
router.patch("/:id", updateReservation);
router.patch("/:id/seat", seatReservation);

export default router;