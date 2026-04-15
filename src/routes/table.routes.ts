import { Router } from "express";
import prisma from "../lib/prisma";

const router = Router();

type TableBoardStatus = "AVAILABLE" | "OCCUPIED_NOW" | "RESERVED_SOON";

type TableBoardReservation = {
  id: string;
  guestName: string;
  guestCount: number;
  startTime: string;
  endTime: string;
  status: string;
};

type TableBoardItem = {
  id: string;
  name: string;
  capacity: number;
  isActive: boolean;
  status: TableBoardStatus;
  activeReservation: TableBoardReservation | null;
  upcomingReservation: TableBoardReservation | null;
};

function toReservationPayload(reservation: any): TableBoardReservation {
  return {
    id: reservation.id,
    guestName: reservation.guestName ?? "Guest",
    guestCount: reservation.guestCount ?? 0,
    startTime: new Date(reservation.startTime).toISOString(),
    endTime: new Date(reservation.endTime).toISOString(),
    status: reservation.status,
  };
}

function getTableDisplayName(table: any): string {
  if (table?.name && String(table.name).trim()) {
    return String(table.name).trim();
  }

  return `Table ${String(table.id).slice(-4)}`;
}

function getTableCapacity(table: any): number {
  if (typeof table?.capacity === "number" && table.capacity > 0) {
    return table.capacity;
  }

  return 0;
}

router.get("/board", async (req, res) => {
  try {
    const restaurantId = String(req.query.restaurantId || "").trim();

    if (!restaurantId) {
      return res.status(400).json({
        success: false,
        error: "restaurantId is required",
      });
    }

    const now = new Date();

    const tables = await prisma.restaurantTable.findMany({
      where: {
        restaurantId,
        isActive: true,
      },
      orderBy: [{ capacity: "asc" }, { createdAt: "asc" }],
    });

    const reservations = await prisma.reservation.findMany({
      where: {
        restaurantId,
        tableId: {
          not: null,
        },
        status: {
          notIn: ["CANCELLED", "NO_SHOW"],
        },
      },
      orderBy: [{ startTime: "asc" }],
    });

    const data: TableBoardItem[] = tables.map((table: any) => {
      const tableReservations = reservations.filter(
        (reservation: any) => reservation.tableId === table.id
      );

      let activeReservation: any = null;
      let upcomingReservation: any = null;

      for (const reservation of tableReservations) {
        const reservationStart = new Date(reservation.startTime);
        const reservationEnd = new Date(reservation.endTime);

        if (reservation.status === "SEATED") {
          activeReservation = reservation;
          break;
        }

        if (
          now >= reservationStart &&
          now < reservationEnd &&
          reservation.status !== "COMPLETED"
        ) {
          activeReservation = reservation;
          break;
        }
      }

      if (!activeReservation) {
        upcomingReservation =
          tableReservations
            .filter((reservation: any) => {
              if (reservation.status === "COMPLETED") return false;
              if (reservation.status === "SEATED") return false;
              return new Date(reservation.startTime) > now;
            })
            .sort(
              (a: any, b: any) =>
                new Date(a.startTime).getTime() -
                new Date(b.startTime).getTime()
            )[0] || null;
      }

      let status: TableBoardStatus = "AVAILABLE";

      if (activeReservation) {
        status = "OCCUPIED_NOW";
      } else if (upcomingReservation) {
        status = "RESERVED_SOON";
      }

      return {
        id: table.id,
        name: getTableDisplayName(table),
        capacity: getTableCapacity(table),
        isActive: table.isActive,
        status,
        activeReservation: activeReservation
          ? toReservationPayload(activeReservation)
          : null,
        upcomingReservation: upcomingReservation
          ? toReservationPayload(upcomingReservation)
          : null,
      };
    });

    return res.json({
      success: true,
      data,
    });
  } catch (error: any) {
    console.error("GET /api/v1/tables/board error:", error);

    return res.status(500).json({
      success: false,
      error: error?.message || "Failed to load table board",
    });
  }
});

export default router;