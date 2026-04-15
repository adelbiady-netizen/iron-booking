import { Router } from "express";
import { PrismaClient } from "@prisma/client";

const router = Router();
const prisma = new PrismaClient();

router.get("/", async (req, res) => {
  try {
    const { restaurantId } = req.query;

    if (!restaurantId || typeof restaurantId !== "string") {
      return res.status(400).json({
        success: false,
        error: "restaurantId is required"
      });
    }

    const tables = await prisma.restaurantTable.findMany({
      where: {
        restaurantId
      },
      orderBy: {
        name: "asc"
      }
    });

    return res.status(200).json({
      success: true,
      count: tables.length,
      data: tables
    });
  } catch (error) {
    console.error("TABLE BOARD ERROR:", error);

    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch table board"
    });
  }
});

export default router;