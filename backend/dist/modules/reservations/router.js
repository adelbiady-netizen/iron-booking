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
const schema_1 = require("./schema");
const service = __importStar(require("./service"));
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
const actorName = (req) => `${req.auth.email}`;
// Express 5 types req.params values as string | string[]; route params from
// :id patterns are always plain strings at runtime.
function p(req, key) {
    const v = req.params[key];
    return Array.isArray(v) ? v[0] : v;
}
// GET /reservations
router.get('/', (0, validate_1.validate)(schema_1.ListReservationsQuerySchema, 'query'), async (req, res, next) => {
    try {
        const result = await service.listReservations(req.auth.restaurantId, req.query);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
// POST /reservations
router.post('/', (0, validate_1.validate)(schema_1.CreateReservationSchema), async (req, res, next) => {
    try {
        const r = await service.createReservation(req.auth.restaurantId, req.body, actorName(req));
        res.status(201).json(r);
    }
    catch (err) {
        next(err);
    }
});
// GET /reservations/:id/timeline — must come before GET /:id to avoid shadowing
router.get('/:id/timeline', async (req, res, next) => {
    try {
        const r = await service.getReservationTimeline(req.auth.restaurantId, p(req, 'id'));
        res.json(r);
    }
    catch (err) {
        next(err);
    }
});
// GET /reservations/:id
router.get('/:id', async (req, res, next) => {
    try {
        const r = await service.getReservation(req.auth.restaurantId, p(req, 'id'));
        res.json(r);
    }
    catch (err) {
        next(err);
    }
});
// PATCH /reservations/:id
router.patch('/:id', (0, validate_1.validate)(schema_1.UpdateReservationSchema), async (req, res, next) => {
    try {
        const r = await service.updateReservation(req.auth.restaurantId, p(req, 'id'), req.body, actorName(req));
        res.json(r);
    }
    catch (err) {
        next(err);
    }
});
// POST /reservations/:id/confirm
router.post('/:id/confirm', async (req, res, next) => {
    try {
        const r = await service.confirmReservation(req.auth.restaurantId, p(req, 'id'), actorName(req));
        res.json(r);
    }
    catch (err) {
        next(err);
    }
});
// POST /reservations/:id/seat
router.post('/:id/seat', (0, validate_1.validate)(schema_1.AssignTableSchema), async (req, res, next) => {
    try {
        const r = await service.seatReservation(req.auth.restaurantId, p(req, 'id'), req.body.tableId, actorName(req), req.body.overrideConflicts);
        res.json(r);
    }
    catch (err) {
        next(err);
    }
});
// POST /reservations/:id/move
router.post('/:id/move', (0, validate_1.validate)(schema_1.MoveTableSchema), async (req, res, next) => {
    try {
        const r = await service.moveReservation(req.auth.restaurantId, p(req, 'id'), req.body, actorName(req));
        res.json(r);
    }
    catch (err) {
        next(err);
    }
});
// POST /reservations/:id/complete
router.post('/:id/complete', async (req, res, next) => {
    try {
        const r = await service.completeReservation(req.auth.restaurantId, p(req, 'id'), actorName(req));
        res.json(r);
    }
    catch (err) {
        next(err);
    }
});
// POST /reservations/:id/no-show
router.post('/:id/no-show', async (req, res, next) => {
    try {
        const r = await service.markNoShow(req.auth.restaurantId, p(req, 'id'), actorName(req));
        res.json(r);
    }
    catch (err) {
        next(err);
    }
});
// POST /reservations/:id/cancel
router.post('/:id/cancel', async (req, res, next) => {
    try {
        const reason = req.body?.reason;
        const r = await service.cancelReservation(req.auth.restaurantId, p(req, 'id'), reason, actorName(req));
        res.json(r);
    }
    catch (err) {
        next(err);
    }
});
// POST /reservations/:id/undo
router.post('/:id/undo', async (req, res, next) => {
    try {
        const r = await service.undoReservation(req.auth.restaurantId, p(req, 'id'), actorName(req));
        res.json(r);
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=router.js.map