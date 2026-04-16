"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = __importDefault(require("../lib/prisma"));
const router = (0, express_1.Router)();
function toReservationPayload(reservation) {
    return {
        id: reservation.id,
        guestName: reservation.guestName ?? "Guest",
        guestCount: reservation.guestCount ?? 0,
        startTime: new Date(reservation.startTime).toISOString(),
        endTime: new Date(reservation.endTime).toISOString(),
        status: reservation.status,
    };
}
function getTableDisplayName(table) {
    if (table?.name && String(table.name).trim()) {
        return String(table.name).trim();
    }
    return `Table ${String(table.id).slice(-4)}`;
}
function getTableCapacity(table) {
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
        const tables = await prisma_1.default.restaurantTable.findMany({
            where: {
                restaurantId,
                isActive: true,
            },
            orderBy: [{ capacity: "asc" }, { createdAt: "asc" }],
        });
        const reservations = await prisma_1.default.reservation.findMany({
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
        const data = tables.map((table) => {
            const tableReservations = reservations.filter((reservation) => reservation.tableId === table.id);
            let activeReservation = null;
            let upcomingReservation = null;
            for (const reservation of tableReservations) {
                const reservationStart = new Date(reservation.startTime);
                const reservationEnd = new Date(reservation.endTime);
                if (reservation.status === "SEATED") {
                    activeReservation = reservation;
                    break;
                }
                if (now >= reservationStart &&
                    now < reservationEnd &&
                    reservation.status !== "COMPLETED") {
                    activeReservation = reservation;
                    break;
                }
            }
            if (!activeReservation) {
                upcomingReservation =
                    tableReservations
                        .filter((reservation) => {
                        if (reservation.status === "COMPLETED")
                            return false;
                        if (reservation.status === "SEATED")
                            return false;
                        return new Date(reservation.startTime) > now;
                    })
                        .sort((a, b) => new Date(a.startTime).getTime() -
                        new Date(b.startTime).getTime())[0] || null;
            }
            let status = "AVAILABLE";
            if (activeReservation) {
                status = "OCCUPIED_NOW";
            }
            else if (upcomingReservation) {
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
    }
    catch (error) {
        console.error("GET /api/v1/tables/board error:", error);
        return res.status(500).json({
            success: false,
            error: error?.message || "Failed to load table board",
        });
    }
});
exports.default = router;
