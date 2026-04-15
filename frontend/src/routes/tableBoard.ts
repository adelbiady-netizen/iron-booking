import { prisma } from "../../lib/prisma";

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
  tableNumber: string;
  shape: string | null;
  minCapacity: number;
  idealCapacity: number;
  maxCapacity: number;
  isCombinable: boolean;
  combineGroup: string | null;
  posX: number | null;
  posY: number | null;
  status: TableBoardStatus;
  activeReservation: TableBoardReservation | null;
  upcomingReservation: TableBoardReservation | null;
};

const CANCELLED_STATUSES = new Set(["CANCELLED", "NO_SHOW"]);

function toReservationPayload(reservation: any): TableBoardReservation {
  return {
    id: reservation.id,
    guestName: reservation.guestName ?? "Guest",
    guestCount: reservation.guestCount ?? 0,
    startTime: reservation.startTime.toISOString(),
    endTime: reservation.endTime.toISOString(),
    status: reservation.status,
  };
}

function isCancelledStatus(status: string): boolean {
  return CANCELLED_STATUSES.has(status);
}

export class TableBoardService {
  static async getTableBoard(restaurantId: string): Promise<TableBoardItem[]> {
    const now = new Date();
    const reservedSoonWindowMinutes = 120;
    const soonThreshold = new Date(
      now.getTime() + reservedSoonWindowMinutes * 60 * 1000
    );

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
      orderBy: {
        tableNumber: "asc",
      },
    });

    const result: TableBoardItem[] = tables.map((table) => {
      const validReservations = table.reservationTables
        .map((rt) => rt.reservation)
        .filter(Boolean)
        .filter((reservation) => !isCancelledStatus(reservation.status))
        .sort(
          (a, b) =>
            new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
        );

      const activeReservation =
        validReservations.find((reservation) => {
          const start = new Date(reservation.startTime);
          const end = new Date(reservation.endTime);
          return start <= now && end > now;
        }) ?? null;

      const upcomingReservation =
        validReservations.find((reservation) => {
          const start = new Date(reservation.startTime);
          return start > now;
        }) ?? null;

      let status: TableBoardStatus = "AVAILABLE";

      if (activeReservation) {
        status = "OCCUPIED_NOW";
      } else if (
        upcomingReservation &&
        new Date(upcomingReservation.startTime) <= soonThreshold
      ) {
        status = "RESERVED_SOON";
      }

      return {
        id: table.id,
        tableNumber: table.tableNumber,
        shape: table.shape,
        minCapacity: table.minCapacity,
        idealCapacity: table.idealCapacity,
        maxCapacity: table.maxCapacity,
        isCombinable: table.isCombinable,
        combineGroup: table.combineGroup,
        posX: table.posX,
        posY: table.posY,
        status,
        activeReservation: activeReservation
          ? toReservationPayload(activeReservation)
          : null,
        upcomingReservation: upcomingReservation
          ? toReservationPayload(upcomingReservation)
          : null,
      };
    });

    return result;
  }
}