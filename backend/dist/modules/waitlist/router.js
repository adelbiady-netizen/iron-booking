"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../../middleware/auth");
const validate_1 = require("../../middleware/validate");
const zod_1 = require("zod");
const service = __importStar(require("./service"));
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
// Express 5 types req.params values as string | string[]; route params from
// :param patterns are always plain strings at runtime.
function p(req, key) {
    const v = req.params[key];
    return Array.isArray(v) ? v[0] : v;
}
// Normalize a validated query string value to string
function q(req, key) {
    const v = req.query[key];
    if (Array.isArray(v))
        return v[0];
    return v;
}
const AddSchema = zod_1.z.object({
    guestName: zod_1.z.string().min(1),
    guestPhone: zod_1.z.string().optional(),
    partySize: zod_1.z.number().int().min(1),
    date: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    source: zod_1.z.enum(['WALK_IN', 'PHONE', 'ONLINE']).optional(),
    notes: zod_1.z.string().optional(),
});
const DateQuerySchema = zod_1.z.object({
    date: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
// GET /waitlist?date=YYYY-MM-DD
router.get('/', (0, validate_1.validate)(DateQuerySchema, 'query'), async (req, res, next) => {
    try {
        const entries = await service.listWaitlist(req.auth.restaurantId, q(req, 'date'));
        res.json(entries);
    }
    catch (err) {
        next(err);
    }
});
// GET /waitlist/stats?date=YYYY-MM-DD
router.get('/stats', (0, validate_1.validate)(DateQuerySchema, 'query'), async (req, res, next) => {
    try {
        const stats = await service.getWaitlistStats(req.auth.restaurantId, q(req, 'date'));
        res.json(stats);
    }
    catch (err) {
        next(err);
    }
});
// POST /waitlist
router.post('/', (0, validate_1.validate)(AddSchema), async (req, res, next) => {
    try {
        const entry = await service.addToWaitlist(req.auth.restaurantId, req.body);
        res.status(201).json(entry);
    }
    catch (err) {
        next(err);
    }
});
// GET /waitlist/:id
router.get('/:id', async (req, res, next) => {
    try {
        const entry = await service.getWaitlistEntry(req.auth.restaurantId, p(req, 'id'));
        res.json(entry);
    }
    catch (err) {
        next(err);
    }
});
// PATCH /waitlist/:id
router.patch('/:id', async (req, res, next) => {
    try {
        const entry = await service.updateWaitlistEntry(req.auth.restaurantId, p(req, 'id'), req.body);
        res.json(entry);
    }
    catch (err) {
        next(err);
    }
});
// POST /waitlist/:id/notify
router.post('/:id/notify', async (req, res, next) => {
    try {
        const entry = await service.notifyGuest(req.auth.restaurantId, p(req, 'id'));
        res.json(entry);
    }
    catch (err) {
        next(err);
    }
});
// POST /waitlist/:id/seat
router.post('/:id/seat', async (req, res, next) => {
    try {
        const result = await service.seatWaitlistGuest(req.auth.restaurantId, p(req, 'id'), req.body.tableId);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
// POST /waitlist/:id/remove
router.post('/:id/remove', async (req, res, next) => {
    try {
        const reason = req.body.reason === 'LEFT' ? 'LEFT' : 'REMOVED';
        const entry = await service.removeFromWaitlist(req.auth.restaurantId, p(req, 'id'), reason);
        res.json(entry);
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=router.js.map