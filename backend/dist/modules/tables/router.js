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
const TableSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    sectionId: zod_1.z.string().uuid().optional(),
    minCovers: zod_1.z.number().int().min(1),
    maxCovers: zod_1.z.number().int().min(1),
    shape: zod_1.z.enum(['ROUND', 'SQUARE', 'RECTANGLE', 'OVAL', 'BOOTH']).optional(),
    isCombinable: zod_1.z.boolean().optional(),
    posX: zod_1.z.number().optional(),
    posY: zod_1.z.number().optional(),
    width: zod_1.z.number().optional(),
    height: zod_1.z.number().optional(),
    rotation: zod_1.z.number().optional(),
    turnTimeMinutes: zod_1.z.number().int().optional(),
    notes: zod_1.z.string().optional(),
});
const BlockSchema = zod_1.z.object({
    tableId: zod_1.z.string().uuid().optional(),
    reason: zod_1.z.string().min(1),
    type: zod_1.z.enum(['EVENT', 'MAINTENANCE', 'VIP_HOLD', 'STAFF_MEAL']).default('EVENT'),
    startTime: zod_1.z.string().datetime(),
    endTime: zod_1.z.string().datetime(),
});
const FloorStateQuerySchema = zod_1.z.object({
    date: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: zod_1.z.string().regex(/^\d{2}:\d{2}$/),
});
const SuggestQuerySchema = zod_1.z.object({
    date: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: zod_1.z.string().regex(/^\d{2}:\d{2}$/),
    partySize: zod_1.z.coerce.number().int().min(1),
    duration: zod_1.z.coerce.number().int().optional(),
    occasion: zod_1.z.string().optional(),
    guestIsVip: zod_1.z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});
// GET /tables/floor — live floor state (must come before /:id)
router.get('/floor', (0, validate_1.validate)(FloorStateQuerySchema, 'query'), async (req, res, next) => {
    try {
        const { date, time } = req.query;
        const state = await service.getFloorState(req.auth.restaurantId, new Date(date + 'T00:00:00.000Z'), time);
        res.json(state);
    }
    catch (err) {
        next(err);
    }
});
// GET /tables/insights — unified host intelligence (late guests, seat now, ending soon)
router.get('/insights', (0, validate_1.validate)(FloorStateQuerySchema, 'query'), async (req, res, next) => {
    try {
        const { date, time } = req.query;
        const insights = await service.getFloorInsights(req.auth.restaurantId, date, time);
        res.json(insights);
    }
    catch (err) {
        next(err);
    }
});
// GET /tables/floor-suggestions — best reservation per available table
router.get('/floor-suggestions', (0, validate_1.validate)(FloorStateQuerySchema, 'query'), async (req, res, next) => {
    try {
        const { date, time } = req.query;
        const suggestions = await service.getFloorSuggestions(req.auth.restaurantId, date, time);
        res.json(suggestions);
    }
    catch (err) {
        next(err);
    }
});
// GET /tables/suggest — smart table suggestions
router.get('/suggest', (0, validate_1.validate)(SuggestQuerySchema, 'query'), async (req, res, next) => {
    try {
        const suggestions = await service.getTableSuggestions(req.auth.restaurantId, req.query);
        res.json(suggestions);
    }
    catch (err) {
        next(err);
    }
});
// GET /tables/blocks
router.get('/blocks', async (req, res, next) => {
    try {
        const rawTableId = req.query.tableId;
        const tableId = Array.isArray(rawTableId)
            ? rawTableId[0]
            : rawTableId;
        const blocks = await service.listBlocks(req.auth.restaurantId, tableId);
        res.json(blocks);
    }
    catch (err) {
        next(err);
    }
});
// POST /tables/blocks
router.post('/blocks', (0, validate_1.validate)(BlockSchema), async (req, res, next) => {
    try {
        const block = await service.blockTable(req.auth.restaurantId, {
            ...req.body,
            startTime: new Date(req.body.startTime),
            endTime: new Date(req.body.endTime),
            createdBy: req.auth.email,
        });
        res.status(201).json(block);
    }
    catch (err) {
        next(err);
    }
});
// DELETE /tables/blocks/:blockId
router.delete('/blocks/:blockId', async (req, res, next) => {
    try {
        await service.unblockTable(req.auth.restaurantId, p(req, 'blockId'));
        res.status(204).send();
    }
    catch (err) {
        next(err);
    }
});
// GET /tables/sections
router.get('/sections', async (req, res, next) => {
    try {
        const sections = await service.listSections(req.auth.restaurantId);
        res.json(sections);
    }
    catch (err) {
        next(err);
    }
});
// POST /tables/sections
router.post('/sections', async (req, res, next) => {
    try {
        const section = await service.upsertSection(req.auth.restaurantId, req.body);
        res.status(201).json(section);
    }
    catch (err) {
        next(err);
    }
});
// GET /tables
router.get('/', async (req, res, next) => {
    try {
        const tables = await service.listTables(req.auth.restaurantId);
        res.json(tables);
    }
    catch (err) {
        next(err);
    }
});
// POST /tables
router.post('/', (0, validate_1.validate)(TableSchema), async (req, res, next) => {
    try {
        const table = await service.createTable(req.auth.restaurantId, req.body);
        res.status(201).json(table);
    }
    catch (err) {
        next(err);
    }
});
// GET /tables/:id
router.get('/:id', async (req, res, next) => {
    try {
        const table = await service.getTable(req.auth.restaurantId, p(req, 'id'));
        res.json(table);
    }
    catch (err) {
        next(err);
    }
});
// PATCH /tables/:id
router.patch('/:id', (0, validate_1.validate)(TableSchema.partial()), async (req, res, next) => {
    try {
        const table = await service.updateTable(req.auth.restaurantId, p(req, 'id'), req.body);
        res.json(table);
    }
    catch (err) {
        next(err);
    }
});
// DELETE /tables/:id
router.delete('/:id', async (req, res, next) => {
    try {
        await service.deleteTable(req.auth.restaurantId, p(req, 'id'));
        res.status(204).send();
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=router.js.map