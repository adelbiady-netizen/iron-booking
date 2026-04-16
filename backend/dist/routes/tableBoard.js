"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
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
    }
    catch (error) {
        console.error("TABLE BOARD ERROR:", error);
        return res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : "Failed to fetch table board"
        });
    }
});
exports.default = router;
