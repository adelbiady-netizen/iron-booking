import { Request, Response } from "express";
import { getTableBoard } from "../services/tableBoard/TableBoardService";

export async function getTableBoardHandler(req: Request, res: Response) {
  try {
    const restaurantId = String(req.query.restaurantId || "").trim();

    if (!restaurantId) {
      return res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "restaurantId is required",
        },
      });
    }

    const data = await getTableBoard(restaurantId);

    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Table Board Error:", error);

    return res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to load table board",
      },
    });
  }
}