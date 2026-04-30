"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const zod_1 = require("zod");
const prisma_1 = require("../../lib/prisma");
const config_1 = require("../../config");
const validate_1 = require("../../middleware/validate");
const errors_1 = require("../../lib/errors");
const router = (0, express_1.Router)();
const LoginSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(1),
});
const RegisterSchema = zod_1.z.object({
    restaurantName: zod_1.z.string().min(1),
    slug: zod_1.z.string().min(2).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
    timezone: zod_1.z.string().default('America/New_York'),
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(8),
    firstName: zod_1.z.string().min(1),
    lastName: zod_1.z.string().min(1),
});
// POST /auth/login
router.post('/login', (0, validate_1.validate)(LoginSchema), async (req, res, next) => {
    try {
        const { email, password } = req.body;
        const user = await prisma_1.prisma.user.findFirst({
            where: { email, isActive: true },
            include: { restaurant: true },
        });
        if (!user)
            throw new errors_1.UnauthorizedError('Invalid credentials');
        const valid = await bcryptjs_1.default.compare(password, user.passwordHash);
        if (!valid)
            throw new errors_1.UnauthorizedError('Invalid credentials');
        await prisma_1.prisma.user.update({
            where: { id: user.id },
            data: { lastLoginAt: new Date() },
        });
        const token = jsonwebtoken_1.default.sign({
            userId: user.id,
            restaurantId: user.restaurantId,
            role: user.role,
            email: user.email,
        }, config_1.config.jwtSecret, { expiresIn: config_1.config.jwtExpiresIn });
        res.json({
            token,
            user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                role: user.role,
                restaurant: {
                    id: user.restaurant.id,
                    name: user.restaurant.name,
                    slug: user.restaurant.slug,
                    timezone: user.restaurant.timezone,
                    settings: user.restaurant.settings,
                },
            },
        });
    }
    catch (err) {
        next(err);
    }
});
// POST /auth/register — creates restaurant + first admin user
router.post('/register', (0, validate_1.validate)(RegisterSchema), async (req, res, next) => {
    try {
        const { restaurantName, slug, timezone, email, password, firstName, lastName } = req.body;
        const passwordHash = await bcryptjs_1.default.hash(password, 12);
        const result = await prisma_1.prisma.$transaction(async (tx) => {
            const restaurant = await tx.restaurant.create({
                data: {
                    name: restaurantName,
                    slug,
                    timezone,
                    settings: {
                        defaultTurnMinutes: 90,
                        slotIntervalMinutes: 15,
                        maxPartySize: 20,
                        depositRequired: false,
                        depositAmountCents: 0,
                        autoConfirm: false,
                        bufferBetweenTurnsMinutes: 15,
                        openingHour: '11:00',
                        closingHour: '22:00',
                        lastSeatingOffset: 60,
                    },
                },
            });
            const user = await tx.user.create({
                data: {
                    restaurantId: restaurant.id,
                    email,
                    passwordHash,
                    firstName,
                    lastName,
                    role: 'ADMIN',
                },
            });
            // Seed 7 default operating hours (all open)
            await tx.operatingHour.createMany({
                data: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
                    restaurantId: restaurant.id,
                    dayOfWeek: day,
                    openTime: '11:00',
                    closeTime: '22:00',
                    lastSeating: '21:00',
                    isOpen: day !== 0, // closed Sundays by default
                })),
            });
            return { restaurant, user };
        });
        const token = jsonwebtoken_1.default.sign({
            userId: result.user.id,
            restaurantId: result.restaurant.id,
            role: result.user.role,
            email: result.user.email,
        }, config_1.config.jwtSecret, { expiresIn: config_1.config.jwtExpiresIn });
        res.status(201).json({
            token,
            user: {
                id: result.user.id,
                email: result.user.email,
                firstName: result.user.firstName,
                lastName: result.user.lastName,
                role: result.user.role,
                restaurant: {
                    id: result.restaurant.id,
                    name: result.restaurant.name,
                    slug: result.restaurant.slug,
                    timezone: result.restaurant.timezone,
                    settings: result.restaurant.settings,
                },
            },
        });
    }
    catch (err) {
        next(err);
    }
});
// ─── Dev-only login ───────────────────────────────────────────────────────────
// Active ONLY when NODE_ENV=development. No password required.
// Self-seeding: creates the dev restaurant + user on first call if missing.
// Use: POST /api/auth/dev-login
// Returns a real JWT valid for all protected routes.
if (process.env.NODE_ENV === 'development') {
    router.post('/dev-login', async (req, res, next) => {
        const DEV_EMAIL = 'dev@ironbooking.com';
        const DEV_SLUG = 'dev';
        try {
            // ── 1. Verify the DB is reachable and tables exist ──────────────────
            // A raw $queryRaw catches "relation does not exist" (schema not pushed)
            // and "authentication failed" (wrong DATABASE_URL) with a clear message.
            try {
                await prisma_1.prisma.$queryRaw `SELECT 1`;
            }
            catch (dbErr) {
                const msg = dbErr?.message ?? String(dbErr);
                const hint = msg.includes('does not exist')
                    ? 'Database tables are missing. Run: npx prisma db push'
                    : msg.includes('password authentication') || msg.includes('P1000')
                        ? 'Wrong DATABASE_URL credentials. Check your .env file.'
                        : msg.includes('ECONNREFUSED') || msg.includes('P1001')
                            ? 'Cannot reach PostgreSQL. Make sure it is running on port 5432.'
                            : `Database error: ${msg}`;
                res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: hint } });
                return;
            }
            // ── 2. Upsert the dev restaurant ────────────────────────────────────
            const restaurant = await prisma_1.prisma.restaurant.upsert({
                where: { slug: DEV_SLUG },
                update: {},
                create: {
                    name: 'Iron Booking Dev',
                    slug: DEV_SLUG,
                    timezone: 'America/New_York',
                    settings: {
                        defaultTurnMinutes: 90,
                        slotIntervalMinutes: 15,
                        maxPartySize: 20,
                        depositRequired: false,
                        depositAmountCents: 0,
                        autoConfirm: false,
                        bufferBetweenTurnsMinutes: 15,
                        openingHour: '11:00',
                        closingHour: '22:00',
                        lastSeatingOffset: 60,
                    },
                },
            });
            // ── 3. Upsert operating hours ────────────────────────────────────────
            for (let day = 0; day <= 6; day++) {
                await prisma_1.prisma.operatingHour.upsert({
                    where: { restaurantId_dayOfWeek: { restaurantId: restaurant.id, dayOfWeek: day } },
                    update: {},
                    create: {
                        restaurantId: restaurant.id,
                        dayOfWeek: day,
                        openTime: '11:00',
                        closeTime: '22:00',
                        lastSeating: '21:00',
                        isOpen: day !== 0,
                    },
                });
            }
            // ── 4. Upsert sections ───────────────────────────────────────────────
            const mainDining = await prisma_1.prisma.section.upsert({
                where: { restaurantId_name: { restaurantId: restaurant.id, name: 'Main Dining' } },
                update: {},
                create: { restaurantId: restaurant.id, name: 'Main Dining', color: '#6366f1', sortOrder: 1 },
            });
            const bar = await prisma_1.prisma.section.upsert({
                where: { restaurantId_name: { restaurantId: restaurant.id, name: 'Bar' } },
                update: {},
                create: { restaurantId: restaurant.id, name: 'Bar', color: '#f59e0b', sortOrder: 2 },
            });
            // ── 5. Upsert tables ─────────────────────────────────────────────────
            const tableDefs = [
                { name: 'T1', sectionId: mainDining.id, minCovers: 2, maxCovers: 4, shape: 'RECTANGLE' },
                { name: 'T2', sectionId: mainDining.id, minCovers: 2, maxCovers: 4, shape: 'RECTANGLE' },
                { name: 'T3', sectionId: mainDining.id, minCovers: 4, maxCovers: 6, shape: 'ROUND' },
                { name: 'T4', sectionId: mainDining.id, minCovers: 4, maxCovers: 8, shape: 'RECTANGLE' },
                { name: 'B1', sectionId: bar.id, minCovers: 1, maxCovers: 2, shape: 'SQUARE' },
            ];
            for (const t of tableDefs) {
                await prisma_1.prisma.table.upsert({
                    where: { restaurantId_name: { restaurantId: restaurant.id, name: t.name } },
                    update: {},
                    create: { restaurantId: restaurant.id, ...t },
                });
            }
            // ── 6. Upsert the dev admin user ─────────────────────────────────────
            const passwordHash = await bcryptjs_1.default.hash('dev123', 10);
            const user = await prisma_1.prisma.user.upsert({
                where: { restaurantId_email: { restaurantId: restaurant.id, email: DEV_EMAIL } },
                update: {},
                create: {
                    restaurantId: restaurant.id,
                    email: DEV_EMAIL,
                    passwordHash,
                    firstName: 'Dev',
                    lastName: 'Host',
                    role: 'ADMIN',
                },
                include: { restaurant: true },
            });
            // ── 7. Sign and return the JWT ───────────────────────────────────────
            const token = jsonwebtoken_1.default.sign({ userId: user.id, restaurantId: user.restaurantId, role: user.role, email: user.email }, config_1.config.jwtSecret, { expiresIn: config_1.config.jwtExpiresIn });
            res.json({
                token,
                note: 'DEV TOKEN — not available in production',
                user: {
                    id: user.id,
                    email: user.email,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    role: user.role,
                    restaurant: {
                        id: restaurant.id,
                        name: restaurant.name,
                        slug: restaurant.slug,
                        timezone: restaurant.timezone,
                        settings: restaurant.settings,
                    },
                },
            });
        }
        catch (err) {
            // In development, surface the real error message so it's easy to debug
            res.status(500).json({
                error: {
                    code: 'DEV_LOGIN_ERROR',
                    message: err?.message ?? 'Unknown error in dev-login',
                },
            });
        }
    });
}
exports.default = router;
//# sourceMappingURL=router.js.map