import { Router } from "express";

const router = Router();

router.get("/", (_req: any, res: any) => {
  res.status(200).json({
    success: true,
    data: [],
    message: "Tables endpoint is live"
  });
});

router.get("/:id", (req: any, res: any) => {
  res.status(200).json({
    success: true,
    data: {
      id: req.params.id
    },
    message: "Single table endpoint is live"
  });
});

router.post("/", (req: any, res: any) => {
  res.status(201).json({
    success: true,
    message: "Create table endpoint is live",
    payload: req.body ?? null
  });
});

router.patch("/:id", (req: any, res: any) => {
  res.status(200).json({
    success: true,
    message: "Update table endpoint is live",
    id: req.params.id,
    payload: req.body ?? null
  });
});

router.delete("/:id", (req: any, res: any) => {
  res.status(200).json({
    success: true,
    message: "Delete table endpoint is live",
    id: req.params.id
  });
});

router.patch("/:id/position", (req: any, res: any) => {
  res.status(200).json({
    success: true,
    message: "Update table position endpoint is live",
    id: req.params.id,
    payload: req.body ?? null
  });
});

export default router;