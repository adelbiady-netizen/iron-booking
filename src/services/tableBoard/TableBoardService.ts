import prisma from "../../lib/prisma";

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

const CANCELLED = new Set(["CANCELLED", "NO_SHOW"]);

function toReservationPayload(r: any): TableBoardReservation {
  return {
    id: r.id,
    guestName: r.guestName ?? "Guest",
    guestCount: r.guestCount ?? 0,
    startTime: new Date(r.startTime).toISOString(),
    endTime: new Date(r.endTime).toISOString(),
    status: r.status,
  };
}

export async function getTableBoard(
  restaurantId: string
): Promise<TableBoardItem[]> {
  const now = new Date();

  const tables = await prisma.table.findMany({
    where: {
      restaurantId,
      isActive: true,
    },
    include: {
      reservationTables: {
        include: {
          reservation: true,
        },
      },
    },
  });

  return tables.map((table: any) => {
    const reservations = (table.reservationTables || [])
      .map((rt: any) => rt.reservation)
      .filter(Boolean);

    let activeReservation = null;
    let upcomingReservation = null;

    for (const r of reservations) {
      if (CANCELLED.has(r.status)) continue;

      const start = new Date(r.startTime);
      const end = new Date(r.endTime);

      // 👇 הכי חשוב: SEATED = OCCUPIED
      if (r.status === "SEATED") {
        activeReservation = r;
        break;
      }

      // 👇 אם עכשיו בזמן
      if (now >= start && now < end && r.status !== "COMPLETED") {
        activeReservation = r;
        break;
      }
    }

    // אם אין active → נחפש upcoming
    if (!activeReservation) {
      upcomingReservation = reservations
        .filter((r: any) => {
          if (CANCELLED.has(r.status)) return false;
          if (r.status === "COMPLETED") return false;
          return new Date(r.startTime) > now;
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
      name: table.name || `Table ${table.tableNumber}`,
      capacity: table.maxCapacity || table.idealCapacity || 0,
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
}