import { Request, Response } from "express";
import { ReservationStatus } from "@prisma/client";
import prisma from "../../../lib/prisma";

const ALLOWED_STATUSES: ReservationStatus[] = [
  "PENDING",
  "CONFIRMED",
  "SEATED",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
];

function isValidStatus(value: unknown): value is ReservationStatus {
  return typeof value === "string" && ALLOWED_STATUSES.includes(value as ReservationStatus);
}

export async function updateReservation(req: Request, res: Response) {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Reservation id is required.",
        },
      });
    }

    const {
      guestName,
      guestPhone,
      guestEmail,
      guestCount,
      startTime,
      endTime,
      durationMin,
      servicePeriod,
      status,
      source,
      isVIP,
      guestNotes,
      staffNotes,
      tableId,
    } = req.body ?? {};

    const existingReservation = await prisma.reservation.findUnique({
      where: { id },
    });

    if (!existingReservation) {
      return res.status(404).json({
        success: false,
        error: {
          code: "NOT_FOUND",
          message: `Reservation not found: ${id}`,
        },
      });
    }

    if (status !== undefined && !isValidStatus(status)) {
      return res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: `Invalid reservation status: ${status}`,
        },
      });
    }

    const updateData: Record<string, any> = {};

    if (guestName !== undefined) {
      if (typeof guestName !== "string" || !guestName.trim()) {
        return res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "guestName must be a non-empty string.",
          },
        });
      }
      updateData.guestName = guestName.trim();
    }

    if (guestPhone !== undefined) {
      updateData.guestPhone = guestPhone ? String(guestPhone).trim() : null;
    }

    if (guestEmail !== undefined) {
      updateData.guestEmail = guestEmail ? String(guestEmail).trim() : null;
    }

    if (guestCount !== undefined) {
      const parsedGuestCount = Number(guestCount);

      if (!Number.isInteger(parsedGuestCount) || parsedGuestCount <= 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "guestCount must be a positive integer.",
          },
        });
      }

      updateData.guestCount = parsedGuestCount;
    }

    if (startTime !== undefined) {
      const parsedStartTime = new Date(startTime);

      if (Number.isNaN(parsedStartTime.getTime())) {
        return res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid startTime.",
          },
        });
      }

      updateData.startTime = parsedStartTime;
    }

    if (endTime !== undefined) {
      const parsedEndTime = new Date(endTime);

      if (Number.isNaN(parsedEndTime.getTime())) {
        return res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid endTime.",
          },
        });
      }

      updateData.endTime = parsedEndTime;
    }

    if (durationMin !== undefined) {
      const parsedDuration = Number(durationMin);

      if (!Number.isInteger(parsedDuration) || parsedDuration <= 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "durationMin must be a positive integer.",
          },
        });
      }

      updateData.durationMin = parsedDuration;
    }

    if (servicePeriod !== undefined) {
      updateData.servicePeriod = servicePeriod;
    }

    if (source !== undefined) {
      updateData.source = source;
    }

    if (typeof isVIP === "boolean") {
      updateData.isVIP = isVIP;
    }

    if (guestNotes !== undefined) {
      updateData.guestNotes = guestNotes ? String(guestNotes).trim() : null;
    }

    if (staffNotes !== undefined) {
      updateData.staffNotes = staffNotes ? String(staffNotes).trim() : null;
    }

    if (tableId !== undefined) {
      updateData.tableId = tableId ? String(tableId).trim() : null;
    }

    if (status !== undefined) {
      updateData.status = status;
    }

    const nextStartTime = updateData.startTime ?? existingReservation.startTime;
    const nextEndTime = updateData.endTime ?? existingReservation.endTime;

    if (nextStartTime && nextEndTime) {
      const startDate = new Date(nextStartTime);
      const endDate = new Date(nextEndTime);

      if (endDate <= startDate) {
        return res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "endTime must be later than startTime.",
          },
        });
      }
    }

    const updatedReservation = await prisma.reservation.update({
      where: { id },
      data: updateData,
    });

    return res.status(200).json({
      success: true,
      data: updatedReservation,
    });
  } catch (error) {
    console.error("updateReservation error:", error);

    return res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to update reservation.",
      },
    });
  }
}

export default updateReservation;