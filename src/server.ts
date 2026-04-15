import express from "express";
import cors from "cors";
import prisma from "./lib/prisma";
import * as http from "http";
import { Server } from "socket.io";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3001;

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

io.on("connection", () => {
  console.log("🔌 Client connected");
});

function emitBoardUpdate(restaurantId: string) {
  io.emit("board:update", { restaurantId });
}

type ReservationStatus =
  | "PENDING"
  | "CONFIRMED"
  | "SEATED"
  | "COMPLETED"
  | "CANCELLED"
  | "NO_SHOW";

const ACTIVE_STATUSES: ReservationStatus[] = [
  "PENDING",
  "CONFIRMED",
  "SEATED",
];

function overlaps(startA: Date, endA: Date, startB: Date, endB: Date) {
  return startA < endB && endA > startB;
}

function getTimeStatus(startTime: Date, endTime: Date) {
  const now = new Date();
  const total = endTime.getTime() - startTime.getTime();
  const passed = now.getTime() - startTime.getTime();
  const ratio = passed / total;

  if (ratio >= 1) return "OVERTIME";
  if (ratio >= 0.8) return "ENDING_SOON";
  return "NORMAL";
}

async function findAvailableTable(
  restaurantId: string,
  guestCount: number,
  startTime: Date,
  endTime: Date
) {
  const tables = await prisma.restaurantTable.findMany({
    where: {
      restaurantId,
      isActive: true,
      capacity: {
        gte: guestCount,
      },
    },
    orderBy: [{ capacity: "asc" }],
  });

  const reservations = await prisma.reservation.findMany({
    where: {
      restaurantId,
      status: {
        in: ACTIVE_STATUSES,
      },
    },
  });

  for (const table of tables) {
    const conflicts = reservations.filter((r) => r.tableId === table.id);

    const hasConflict = conflicts.some((r) =>
      overlaps(startTime, endTime, r.startTime, r.endTime)
    );

    if (!hasConflict) return table;
  }

  return null;
}

app.get("/api/v1/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/v1/tables/board", async (req, res) => {
  try {
    const { restaurantId } = req.query;

    if (!restaurantId) {
      return res.status(400).json({
        error: "restaurantId is required",
      });
    }

    const tables = await prisma.restaurantTable.findMany({
      where: {
        restaurantId: String(restaurantId),
        isActive: true,
      },
      orderBy: [{ name: "asc" }],
    });

    const reservations = await prisma.reservation.findMany({
      where: {
        restaurantId: String(restaurantId),
        status: {
          in: ACTIVE_STATUSES,
        },
      },
    });

    const now = new Date();

    const result = tables.map((table) => {
      const tableReservations = reservations.filter((r) => r.tableId === table.id);

      let activeReservation: any = null;
      let upcomingReservation: any = null;

      for (const r of tableReservations) {
        const start = new Date(r.startTime);
        const end = new Date(r.endTime);

        if (r.status === "SEATED" && start <= now && end >= now) {
          activeReservation = r;
        }

        if (start > now) {
          if (
            !upcomingReservation ||
            new Date(upcomingReservation.startTime) > start
          ) {
            upcomingReservation = r;
          }
        }
      }

      let status: "AVAILABLE" | "OCCUPIED_NOW" | "RESERVED_SOON" = "AVAILABLE";

      if (activeReservation) {
        status = "OCCUPIED_NOW";
      } else if (upcomingReservation) {
        const minutes =
          (new Date(upcomingReservation.startTime).getTime() - now.getTime()) /
          60000;

        if (minutes <= 30) {
          status = "RESERVED_SOON";
        }
      }

      let timeStatus: "NORMAL" | "ENDING_SOON" | "OVERTIME" = "NORMAL";

      if (activeReservation) {
        timeStatus = getTimeStatus(
          new Date(activeReservation.startTime),
          new Date(activeReservation.endTime)
        );
      }

      return {
        id: table.id,
        name: table.name,
        capacity: table.capacity,
        isActive: table.isActive,
        status,
        timeStatus,
        activeReservation: activeReservation
          ? {
              id: activeReservation.id,
              guestName: activeReservation.guestName,
              guestCount: activeReservation.guestCount,
              startTime: activeReservation.startTime,
              endTime: activeReservation.endTime,
              status: activeReservation.status,
              capacityOverride: activeReservation.capacityOverride,
              reservedSoonOverride: activeReservation.reservedSoonOverride,
              overrideNote: activeReservation.overrideNote,
            }
          : null,
        upcomingReservation: upcomingReservation
          ? {
              id: upcomingReservation.id,
              guestName: upcomingReservation.guestName,
              guestCount: upcomingReservation.guestCount,
              startTime: upcomingReservation.startTime,
              endTime: upcomingReservation.endTime,
              status: upcomingReservation.status,
            }
          : null,
      };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/v1/reservations/walk-in", async (req, res) => {
  try {
    const {
      restaurantId,
      guestName,
      guestPhone,
      guestCount,
      tableId,
      force = false,
    } = req.body;

    if (!restaurantId || !guestCount) {
      return res.status(400).json({
        error: "restaurantId and guestCount are required",
      });
    }

    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
    });

    if (!restaurant) {
      return res.status(404).json({
        error: `Restaurant not found: ${restaurantId}`,
      });
    }

    const now = new Date();
    const duration = restaurant.defaultDuration || 90;
    const endTime = new Date(now.getTime() + duration * 60000);

    let selectedTable: any = null;

    if (tableId) {
      selectedTable = await prisma.restaurantTable.findUnique({
        where: { id: tableId },
      });
    } else {
      selectedTable = await findAvailableTable(
        restaurantId,
        Number(guestCount),
        now,
        endTime
      );
    }

    let capacityOverride = false;
    let reservedSoonOverride = false;
    let overrideNote: string | null = null;
    let overrideApprovedBy: string | null = null;

    if (!selectedTable && force) {
      const allTables = await prisma.restaurantTable.findMany({
        where: {
          restaurantId,
          isActive: true,
        },
        orderBy: [{ capacity: "desc" }],
      });

      const reservations = await prisma.reservation.findMany({
        where: {
          restaurantId,
          status: {
            in: ACTIVE_STATUSES,
          },
        },
      });

      for (const table of allTables) {
        const conflicts = reservations.filter((r) => r.tableId === table.id);

        const hasConflict = conflicts.some((r) =>
          overlaps(now, endTime, r.startTime, r.endTime)
        );

        if (!hasConflict) {
          selectedTable = table;

          if (table.capacity < guestCount) {
            capacityOverride = true;
            overrideNote = "Forced: capacity too small";
          }

          break;
        }
      }

      if (!selectedTable && allTables.length > 0) {
        selectedTable = allTables[0];
        capacityOverride = selectedTable.capacity < guestCount;
        reservedSoonOverride = true;
        overrideNote = "Forced: conflict / reserved soon";
      }

      overrideApprovedBy = "SYSTEM";
    }

    if (!selectedTable) {
      return res.status(400).json({
        error: "No table available",
      });
    }

    const reservation = await prisma.reservation.create({
      data: {
        restaurantId,
        tableId: selectedTable.id,
        guestName: guestName || "Walk-in",
        guestPhone: guestPhone || null,
        guestCount: Number(guestCount),
        startTime: now,
        endTime,
        durationMin: duration,
        servicePeriod: "DINNER",
        status: "SEATED",
        source: "WALK_IN",
        capacityOverride,
        reservedSoonOverride,
        overrideNote,
        overrideApprovedBy,
      },
    });

    emitBoardUpdate(restaurantId);

    res.json({
      success: true,
      tableAssigned: {
        id: selectedTable.id,
        name: selectedTable.name,
        capacity: selectedTable.capacity,
      },
      overrides: {
        capacityOverride,
        reservedSoonOverride,
        overrideNote,
      },
      data: reservation,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.patch("/api/v1/reservations/:id/seat", async (req, res) => {
  try {
    const reservation = await prisma.reservation.update({
      where: { id: req.params.id },
      data: { status: "SEATED" },
    });

    emitBoardUpdate(reservation.restaurantId);
    res.json({ success: true, data: reservation });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Seat failed" });
  }
});

app.patch("/api/v1/reservations/:id/complete", async (req, res) => {
  try {
    const reservation = await prisma.reservation.update({
      where: { id: req.params.id },
      data: {
        status: "COMPLETED",
        actualEndTime: new Date(),
      },
    });

    emitBoardUpdate(reservation.restaurantId);
    res.json({ success: true, data: reservation });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Complete failed" });
  }
});

app.patch("/api/v1/reservations/:id/cancel", async (req, res) => {
  try {
    const reservation = await prisma.reservation.update({
      where: { id: req.params.id },
      data: { status: "CANCELLED" },
    });

    emitBoardUpdate(reservation.restaurantId);
    res.json({ success: true, data: reservation });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Cancel failed" });
  }
});

app.patch("/api/v1/reservations/:id/no-show", async (req, res) => {
  try {
    const reservation = await prisma.reservation.update({
      where: { id: req.params.id },
      data: { status: "NO_SHOW" },
    });

    emitBoardUpdate(reservation.restaurantId);
    res.json({ success: true, data: reservation });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No-show failed" });
  }
});

app.patch("/api/v1/reservations/:id/extend", async (req, res) => {
  try {
    const { id } = req.params;
    const { minutes = 15 } = req.body;

    const reservation = await prisma.reservation.findUnique({
      where: { id },
    });

    if (!reservation) {
      return res.status(404).json({ error: "Reservation not found" });
    }

    const newEndTime = new Date(
      new Date(reservation.endTime).getTime() + Number(minutes) * 60000
    );

    const updated = await prisma.reservation.update({
      where: { id },
      data: {
        endTime: newEndTime,
      },
    });

    emitBoardUpdate(reservation.restaurantId);

    res.json({
      success: true,
      data: updated,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Extend failed" });
  }
});

const notifiedReservations = new Set<string>();

async function checkTableTimes() {
  try {
    const reservations = await prisma.reservation.findMany({
      where: {
        status: "SEATED",
      },
    });

    for (const r of reservations) {
      const timeStatus = getTimeStatus(
        new Date(r.startTime),
        new Date(r.endTime)
      );

      const keySoon = `${r.id}_ENDING_SOON`;
      const keyOver = `${r.id}_OVERTIME`;

      if (timeStatus === "ENDING_SOON" && !notifiedReservations.has(keySoon)) {
        console.log(`⚠️ Ending soon: ${r.guestName}`);
        notifiedReservations.add(keySoon);
        emitBoardUpdate(r.restaurantId);
      }

      if (timeStatus === "OVERTIME" && !notifiedReservations.has(keyOver)) {
        console.log(`🔥 Overtime: ${r.guestName}`);
        notifiedReservations.add(keyOver);
        emitBoardUpdate(r.restaurantId);
      }
    }
  } catch (err) {
    console.error(err);
  }
}

setInterval(checkTableTimes, 10000);

server.listen(PORT, () => {
  console.log(`🚀 Iron Booking API running on http://localhost:${PORT}`);
});