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
// Helper: Express 5 types req.params values as string | string[] — route
// params from :id patterns are always plain strings at runtime.
function p(req, key) {
    const v = req.params[key];
    return Array.isArray(v) ? v[0] : v;
}
const GuestSchema = zod_1.z.object({
    firstName: zod_1.z.string().min(1),
    lastName: zod_1.z.string().min(1),
    email: zod_1.z.string().email().optional(),
    phone: zod_1.z.string().optional(),
    isVip: zod_1.z.boolean().optional(),
    allergies: zod_1.z.array(zod_1.z.string()).optional(),
    tags: zod_1.z.array(zod_1.z.string()).optional(),
    // Zod v4 requires both key and value schemas for z.record()
    preferences: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
    internalNotes: zod_1.z.string().optional(),
});
const SearchQuerySchema = zod_1.z.object({
    search: zod_1.z.string().optional(),
    isVip: zod_1.z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
    isBlacklisted: zod_1.z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
    tag: zod_1.z.string().optional(),
    page: zod_1.z.coerce.number().int().min(1).default(1),
    limit: zod_1.z.coerce.number().int().min(1).max(100).default(30),
});
// GET /guests
router.get('/', (0, validate_1.validate)(SearchQuerySchema, 'query'), async (req, res, next) => {
    try {
        const result = await service.searchGuests(req.auth.restaurantId, req.query);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
// POST /guests
router.post('/', (0, validate_1.validate)(GuestSchema), async (req, res, next) => {
    try {
        const guest = await service.createGuest(req.auth.restaurantId, req.body);
        res.status(201).json(guest);
    }
    catch (err) {
        next(err);
    }
});
// POST /guests/find-or-create
router.post('/find-or-create', async (req, res, next) => {
    try {
        const result = await service.findOrCreateGuest(req.auth.restaurantId, req.body);
        res.status(result.created ? 201 : 200).json(result);
    }
    catch (err) {
        next(err);
    }
});
// GET /guests/:id
router.get('/:id', async (req, res, next) => {
    try {
        const guest = await service.getGuest(req.auth.restaurantId, p(req, 'id'));
        res.json(guest);
    }
    catch (err) {
        next(err);
    }
});
// PATCH /guests/:id
router.patch('/:id', (0, validate_1.validate)(GuestSchema.partial()), async (req, res, next) => {
    try {
        const guest = await service.updateGuest(req.auth.restaurantId, p(req, 'id'), req.body);
        res.json(guest);
    }
    catch (err) {
        next(err);
    }
});
// POST /guests/:id/merge — merge duplicate into primary
router.post('/:id/merge', async (req, res, next) => {
    try {
        const { duplicateId } = req.body;
        const result = await service.mergeGuests(req.auth.restaurantId, p(req, 'id'), duplicateId);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=router.js.map