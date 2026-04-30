"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../../middleware/auth");
const validate_1 = require("../../middleware/validate");
const zod_1 = require("zod");
const prisma_1 = require("../../lib/prisma");
const date_fns_1 = require("date-fns");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
const DateRangeSchema = zod_1.z.object({
    dateFrom: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dateTo: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
// GET /analytics/summary?dateFrom=&dateTo=
router.get('/summary', (0, validate_1.validate)(DateRangeSchema, 'query'), async (req, res, next) => {
    try {
        const { dateFrom, dateTo } = req.query;
        const from = new Date(dateFrom + 'T00:00:00.000Z');
        const to = new Date(dateTo + 'T00:00:00.000Z');
        const restaurantId = req.auth.restaurantId;
        const [totalReservations, totalCovers, byStatus] = await Promise.all([
            prisma_1.prisma.reservation.count({ where: { restaurantId, date: { gte: from, lte: to } } }),
            prisma_1.prisma.reservation.aggregate({
                where: { restaurantId, date: { gte: from, lte: to }, status: { in: ['SEATED', 'COMPLETED'] } },
                _sum: { partySize: true },
            }),
            prisma_1.prisma.reservation.groupBy({
                by: ['status'],
                where: { restaurantId, date: { gte: from, lte: to } },
                _count: true,
            }),
        ]);
        const noShows = byStatus.find((s) => s.status === 'NO_SHOW')?._count ?? 0;
        const completed = byStatus.find((s) => s.status === 'COMPLETED')?._count ?? 0;
        const noShowRate = totalReservations > 0 ? ((noShows / totalReservations) * 100).toFixed(1) : '0.0';
        res.json({
            dateFrom,
            dateTo,
            totalReservations,
            totalCovers: totalCovers._sum.partySize ?? 0,
            noShowRate: `${noShowRate}%`,
            byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
        });
    }
    catch (err) {
        next(err);
    }
});
// GET /analytics/covers-by-hour?dateFrom=&dateTo=
router.get('/covers-by-hour', (0, validate_1.validate)(DateRangeSchema, 'query'), async (req, res, next) => {
    try {
        const { dateFrom, dateTo } = req.query;
        const restaurantId = req.auth.restaurantId;
        const reservations = await prisma_1.prisma.reservation.findMany({
            where: {
                restaurantId,
                date: {
                    gte: new Date(dateFrom + 'T00:00:00.000Z'),
                    lte: new Date(dateTo + 'T00:00:00.000Z'),
                },
                status: { in: ['SEATED', 'COMPLETED'] },
            },
            select: { time: true, partySize: true },
        });
        const byHour = {};
        for (const r of reservations) {
            const hour = parseInt(r.time.split(':')[0], 10);
            byHour[hour] = (byHour[hour] ?? 0) + r.partySize;
        }
        const result = Array.from({ length: 24 }, (_, h) => ({
            hour: h,
            label: `${String(h).padStart(2, '0')}:00`,
            covers: byHour[h] ?? 0,
        })).filter((h) => h.covers > 0);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
// GET /analytics/turn-times?dateFrom=&dateTo=
router.get('/turn-times', (0, validate_1.validate)(DateRangeSchema, 'query'), async (req, res, next) => {
    try {
        const { dateFrom, dateTo } = req.query;
        const restaurantId = req.auth.restaurantId;
        const completed = await prisma_1.prisma.reservation.findMany({
            where: {
                restaurantId,
                date: {
                    gte: new Date(dateFrom + 'T00:00:00.000Z'),
                    lte: new Date(dateTo + 'T00:00:00.000Z'),
                },
                status: 'COMPLETED',
                seatedAt: { not: null },
                completedAt: { not: null },
            },
            select: { seatedAt: true, completedAt: true, partySize: true, tableId: true },
        });
        const turns = completed.map((r) => ({
            actualMinutes: (0, date_fns_1.differenceInMinutes)(r.completedAt, r.seatedAt),
            partySize: r.partySize,
        }));
        const avg = turns.length > 0
            ? Math.round(turns.reduce((a, t) => a + t.actualMinutes, 0) / turns.length)
            : 0;
        const byPartySize = {};
        for (const t of turns) {
            const key = Math.min(t.partySize, 8); // group 8+
            if (!byPartySize[key])
                byPartySize[key] = { count: 0, totalMinutes: 0 };
            byPartySize[key].count++;
            byPartySize[key].totalMinutes += t.actualMinutes;
        }
        res.json({
            avgTurnMinutes: avg,
            sampleSize: turns.length,
            byPartySize: Object.entries(byPartySize).map(([size, data]) => ({
                partySize: parseInt(size),
                avgMinutes: Math.round(data.totalMinutes / data.count),
                count: data.count,
            })),
        });
    }
    catch (err) {
        next(err);
    }
});
// GET /analytics/occupancy?date=YYYY-MM-DD
router.get('/occupancy', async (req, res, next) => {
    try {
        const dateStr = req.query.date;
        const restaurantId = req.auth.restaurantId;
        if (!dateStr) {
            res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'date is required' } });
            return;
        }
        const date = new Date(dateStr + 'T00:00:00.000Z');
        const [tables, reservations] = await Promise.all([
            prisma_1.prisma.table.count({ where: { restaurantId, isActive: true } }),
            prisma_1.prisma.reservation.findMany({
                where: { restaurantId, date, status: { in: ['SEATED', 'COMPLETED', 'CONFIRMED'] } },
                select: { time: true, duration: true, partySize: true, status: true },
            }),
        ]);
        // Build 15-min slot occupancy grid
        const slots = {};
        for (const r of reservations) {
            const [h, m] = r.time.split(':').map(Number);
            let minutes = h * 60 + m;
            const end = minutes + r.duration;
            while (minutes < end) {
                const label = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
                slots[label] = (slots[label] ?? 0) + 1;
                minutes += 15;
            }
        }
        const occupancy = Object.entries(slots)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([time, occupied]) => ({
            time,
            occupied,
            total: tables,
            pct: tables > 0 ? Math.round((occupied / tables) * 100) : 0,
        }));
        res.json({ date: dateStr, totalTables: tables, occupancy });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=router.js.map