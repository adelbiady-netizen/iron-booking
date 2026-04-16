import { Router } from "express";

const router = Router();

router.get("/", (_req, res) => {
  res.status(200).json({
    success: true,
    data: [],
    message: "Reservations endpoint is live"
  });
});

router.post("/", (req, res) => {
  res.status(201).json({
    success: true,
    message: "Create reservation endpoint is live",
    payload: req.body ?? null
  });
});

router.patch("/:id", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Update reservation endpoint is live",
    id: req.params.id,
    payload: req.body ?? null
  });
});

router.patch("/:id/seat", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Seat reservation endpoint is live",
    id: req.params.id
  });
});

router.patch("/:id/complete", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Complete reservation endpoint is live",
    id: req.params.id
  });
});

router.patch("/:id/cancel", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Cancel reservation endpoint is live",
    id: req.params.id
  });
});

router.patch("/:id/no-show", (req, res) => {
  res.status(200).json({
    success: true,
    message: "No-show reservation endpoint is live",
    id: req.params.id
  });
});

export default router;