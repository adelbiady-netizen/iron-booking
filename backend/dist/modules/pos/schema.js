"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PosIngestBodySchema = exports.PosEventEnvelopeSchema = void 0;
const zod_1 = require("zod");
exports.PosEventEnvelopeSchema = zod_1.z.object({
    envelope_version: zod_1.z.literal(1),
    event_id: zod_1.z.string().uuid(),
    type: zod_1.z.string(),
    version: zod_1.z.number().int(),
    occurred_at: zod_1.z.string().datetime(),
    source: zod_1.z.string(),
    brand_id: zod_1.z.string().uuid(),
    location_id: zod_1.z.string().uuid(),
    visit_id: zod_1.z.string().uuid().nullable(),
    sequence: zod_1.z.number().int(),
    causation_id: zod_1.z.string().uuid().nullable(),
    payload: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()),
});
exports.PosIngestBodySchema = zod_1.z.object({
    events: zod_1.z.array(exports.PosEventEnvelopeSchema).min(1).max(100),
});
