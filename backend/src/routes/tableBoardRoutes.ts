import { Router } from "express";
import prisma from "../lib/prisma";

const router = Router();

router.get("/board", async (req: any, res: any) => {
  try {
    const restaurantId = String(req.query.restaurantId || "").trim();

    if (!restaurantId) {
      return res.status(400).json({
        success: false,
        message: "restaurantId is required"
      });
    }

    const tables = await prisma.restaurantTable.findMany({
      where: {
        restaurantId,
        isActive: true
      },
      orderBy: [{ name: "asc" }]
    });

    const data = tables.map((table) => ({
      id: table.id,
      name: table.name,
      capacity: table.capacity,
      isActive: table.isActive,
      status: "AVAILABLE",
      activeReservation: null,
      upcomingReservation: null
    }));

    return res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    console.error("table board error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load table board"
    });
  }
});

export default router;