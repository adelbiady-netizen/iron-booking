app.post("/api/v1/reservations", async (req, res) => {
  try {
    const {
      restaurantId,
      guestName,
      guestPhone,
      guestEmail,
      guestNotes,
      staffNotes,
      guestCount,
      date,
      startTime,
      time,
      durationMin,
      servicePeriod,
    } = req.body;

    if (!restaurantId) {
      return res.status(400).json({
        success: false,
        error: "restaurantId is required",
      });
    }

    if (!guestName) {
      return res.status(400).json({
        success: false,
        error: "guestName is required",
      });
    }

    if (!guestCount || Number(guestCount) <= 0) {
      return res.status(400).json({
        success: false,
        error: "guestCount must be greater than 0",
      });
    }

    if (!durationMin || Number(durationMin) <= 0) {
      return res.status(400).json({
        success: false,
        error: "durationMin must be greater than 0",
      });
    }

    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
    });

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        error: {
          code: "NOT_FOUND",
          message: `Restaurant not found: ${restaurantId}`,
        },
      });
    }

    let start: Date;
    const rawTime = time || startTime;

    const isTimeOnly =
      typeof rawTime === "string" && /^\d{2}:\d{2}$/.test(rawTime);

    if (date && isTimeOnly) {
      start = new Date(`${date}T${rawTime}:00`);
    } else if (typeof startTime === "string" && startTime.trim()) {
      start = new Date(startTime);
    } else {
      return res.status(400).json({
        success: false,
        error: "date and time are required",
      });
    }

    if (Number.isNaN(start.getTime())) {
      return res.status(400).json({
        success: false,
        error: "Invalid reservation start time",
      });
    }

    const end = new Date(start.getTime() + Number(durationMin) * 60000);

    const tables = await prisma.table.findMany({
      where: {
        restaurantId,
        isActive: true,
        minCapacity: {
          lte: Number(guestCount),
        },
        maxCapacity: {
          gte: Number(guestCount),
        },
      },
      include: {
        reservationTables: {
          include: {
            reservation: true,
          },
        },
      },
      orderBy: [{ tableNumber: "asc" }, { createdAt: "asc" }],
    });

    let selectedTable = null;

    for (const table of tables) {
      const hasConflict = table.reservationTables.some((rt) => {
        const r = rt.reservation;

        if (!r) return false;
        if (r.status === "CANCELLED" || r.status === "NO_SHOW") return false;

        return start < new Date(r.endTime) && end > new Date(r.startTime);
      });

      if (!hasConflict) {
        selectedTable = table;
        break;
      }
    }

    if (!selectedTable) {
      return res.status(400).json({
        success: false,
        error: {
          code: "NO_TABLE",
          message: "No available table",
        },
      });
    }

    const reservation = await prisma.reservation.create({
      data: {
        restaurantId,
        guestName,
        guestPhone: guestPhone || null,
        guestEmail: guestEmail || null,
        guestNotes: guestNotes || null,
        staffNotes: staffNotes || null,
        guestCount: Number(guestCount),
        startTime: start,
        endTime: end,
        durationMin: Number(durationMin),
        servicePeriod: servicePeriod || "DINNER",
        status: "PENDING",
        source: "HOST",
      },
    });

    await prisma.reservationTable.create({
      data: {
        reservationId: reservation.id,
        tableId: selectedTable.id,
      },
    });

    return res.json({
      success: true,
      tableAssigned: {
        id: selectedTable.id,
        name: selectedTable.name || `Table ${selectedTable.tableNumber}`,
        capacity: selectedTable.maxCapacity || selectedTable.idealCapacity || 0,
      },
      data: reservation,
    });
  } catch (error) {
    console.error("Create reservation error:", error);

    return res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Something went wrong",
      },
    });
  }
});