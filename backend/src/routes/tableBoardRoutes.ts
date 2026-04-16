import { Router } from "express";

const router = Router();

router.get("/board", (_req, res) => {
  res.status(200).json({
    success: true,
    data: [],
    message: "Table board endpoint is live"
  });
});

export default router;