import { z } from 'zod';

export const PosEventEnvelopeSchema = z.object({
  envelope_version: z.literal(1),
  event_id:         z.string().uuid(),
  type:             z.string(),
  version:          z.number().int(),
  occurred_at:      z.string().datetime(),
  source:           z.string(),
  brand_id:         z.string().uuid(),
  location_id:      z.string().uuid(),
  visit_id:         z.string().uuid().nullable(),
  sequence:         z.number().int(),
  causation_id:     z.string().uuid().nullable(),
  payload:          z.record(z.string(), z.unknown()),
});

export const PosIngestBodySchema = z.object({
  events: z.array(PosEventEnvelopeSchema).min(1).max(100),
});

export type PosEventEnvelope = z.infer<typeof PosEventEnvelopeSchema>;
