import { Router } from "express";
import { getTableBoardHandler } from "../controllers/tableBoardController";

const router = Router();

// GET /api/v1/table-board
router.get("/", getTableBoardHandler);

export default router;