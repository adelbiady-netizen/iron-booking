import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { z } from 'zod';
import * as service from './service';

const router = Router();
router.use(authenticate);

// Express 5 types req.params values as string | string[]; route params from
// :param patterns are always plain strings at runtime.
function p(req: Request, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : (v as string);
}

// Normalize a validated query string value to string
function q(req: Request, key: string): string {
  const v = req.query[key];
  if (Array.isArray(v)) return v[0] as string;
  return v as string;
}

const TableSchema = z.object({
  name: z.string().min(1),
  sectionId: z.string().uuid().nullable().optional(),
  minCovers: z.number().int().min(1),
  maxCovers: z.number().int().min(1),
  shape: z.enum(['ROUND', 'SQUARE', 'RECTANGLE', 'OVAL', 'BOOTH']).optional(),
  isActive: z.boolean().optional(),
  isCombinable: z.boolean().optional(),
  locked: z.boolean().optional(),
  posX: z.number().optional(),
  posY: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  rotation: z.number().optional(),
  turnTimeMinutes: z.number().int().optional(),
  notes: z.string().optional(),
});

const BlockSchema = z.object({
  tableId: z.string().uuid().optional(),
  reason: z.string().min(1),
  type: z.enum(['EVENT', 'MAINTENANCE', 'VIP_HOLD', 'STAFF_MEAL']).default('EVENT'),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
});

const FloorStateQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
});

const SuggestQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  partySize: z.coerce.number().int().min(1),
  duration: z.coerce.number().int().optional(),
  occasion: z.string().optional(),
  guestIsVip: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

type FloorStateQuery = z.infer<typeof FloorStateQuerySchema>;
type SuggestQuery = z.infer<typeof SuggestQuerySchema>;

// GET /tables/floor — live floor state (must come before /:id)
router.get('/floor', validate(FloorStateQuerySchema, 'query'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { date, time } = req.query as unknown as FloorStateQuery;
    const state = await service.getFloorState(
      req.auth.restaurantId,
      new Date(date + 'T00:00:00.000Z'),
      time
    );
    res.json(state);
  } catch (err) { next(err); }
});

// GET /tables/insights — unified host intelligence (late guests, seat now, ending soon)
router.get('/insights', validate(FloorStateQuerySchema, 'query'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { date, time } = req.query as unknown as FloorStateQuery;
    const insights = await service.getFloorInsights(req.auth.restaurantId, date, time);
    res.json(insights);
  } catch (err) { next(err); }
});

// GET /tables/floor-suggestions — best reservation per available table
router.get('/floor-suggestions', validate(FloorStateQuerySchema, 'query'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { date, time } = req.query as unknown as FloorStateQuery;
    const suggestions = await service.getFloorSuggestions(req.auth.restaurantId, date, time);
    res.json(suggestions);
  } catch (err) { next(err); }
});

// GET /tables/suggest — smart table suggestions
router.get('/suggest', validate(SuggestQuerySchema, 'query'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const suggestions = await service.getTableSuggestions(
      req.auth.restaurantId,
      req.query as unknown as SuggestQuery
    );
    res.json(suggestions);
  } catch (err) { next(err); }
});

// GET /tables/blocks
router.get('/blocks', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawTableId = req.query.tableId;
    const tableId = Array.isArray(rawTableId)
      ? (rawTableId[0] as string)
      : (rawTableId as string | undefined);
    const blocks = await service.listBlocks(req.auth.restaurantId, tableId);
    res.json(blocks);
  } catch (err) { next(err); }
});

// POST /tables/blocks
router.post('/blocks', validate(BlockSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const block = await service.blockTable(req.auth.restaurantId, {
      ...req.body,
      startTime: new Date(req.body.startTime),
      endTime: new Date(req.body.endTime),
      createdBy: req.auth.email,
    });
    res.status(201).json(block);
  } catch (err) { next(err); }
});

// DELETE /tables/blocks/:blockId
router.delete('/blocks/:blockId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await service.unblockTable(req.auth.restaurantId, p(req, 'blockId'));
    res.status(204).send();
  } catch (err) { next(err); }
});

// GET /tables/floor-objects
router.get('/floor-objects', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const objs = await service.listFloorObjects(req.auth.restaurantId);
    res.json(objs);
  } catch (err) { next(err); }
});

const FloorObjectItemSchema = z.object({
  kind: z.enum(['WALL', 'DIVIDER', 'BAR', 'ENTRANCE', 'ZONE']),
  label: z.string().min(1),
  posX: z.number(),
  posY: z.number(),
  width: z.number().min(1),
  height: z.number().min(1),
  rotation: z.number().optional(),
  color: z.string().nullable().optional(),
});

const BatchFloorObjectsSchema = z.object({
  objects: z.array(FloorObjectItemSchema),
});

// POST /tables/floor-objects/batch — atomic full replace
router.post('/floor-objects/batch', validate(BatchFloorObjectsSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await service.batchSaveFloorObjects(req.auth.restaurantId, req.body.objects);
    res.json(result);
  } catch (err) { next(err); }
});

// GET /tables/sections
router.get('/sections', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sections = await service.listSections(req.auth.restaurantId);
    res.json(sections);
  } catch (err) { next(err); }
});

// POST /tables/sections
router.post('/sections', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const section = await service.upsertSection(req.auth.restaurantId, req.body);
    res.status(201).json(section);
  } catch (err) { next(err); }
});

// GET /tables
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tables = await service.listTables(req.auth.restaurantId);
    res.json(tables);
  } catch (err) { next(err); }
});

// POST /tables
router.post('/', validate(TableSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const table = await service.createTable(req.auth.restaurantId, req.body);
    res.status(201).json(table);
  } catch (err) { next(err); }
});

// GET /tables/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const table = await service.getTable(req.auth.restaurantId, p(req, 'id'));
    res.json(table);
  } catch (err) { next(err); }
});

// PATCH /tables/:id/lock
const LockSchema = z.object({
  reason:      z.string().nullable().optional(),
  lockedUntil: z.string().datetime().nullable().optional(),
});

router.patch('/:id/lock', validate(LockSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const table = await service.lockTable(req.auth.restaurantId, p(req, 'id'), {
      reason:      req.body.reason ?? null,
      lockedUntil: req.body.lockedUntil ? new Date(req.body.lockedUntil) : null,
    });
    res.json(table);
  } catch (err) { next(err); }
});

// PATCH /tables/:id/unlock
router.patch('/:id/unlock', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const table = await service.unlockTable(req.auth.restaurantId, p(req, 'id'));
    res.json(table);
  } catch (err) { next(err); }
});

// PATCH /tables/:id
router.patch('/:id', validate(TableSchema.partial()), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const table = await service.updateTable(req.auth.restaurantId, p(req, 'id'), req.body);
    res.json(table);
  } catch (err) { next(err); }
});

// DELETE /tables/:id
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await service.deleteTable(req.auth.restaurantId, p(req, 'id'));
    res.status(204).send();
  } catch (err) { next(err); }
});

export default router;
