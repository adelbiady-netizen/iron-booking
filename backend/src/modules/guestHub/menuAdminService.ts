// ─── Guest Hub menu admin service ────────────────────────────────────────────
// Authenticated CRUD for GuestHubMenu, GuestHubMenuCategory, GuestHubDish.
//
// ISOLATION: imports from ../../lib/prisma and ../../lib/errors only.
//            No reservation, waitlist, floor, or SSE imports.
//
// SECURITY: all write operations verify category/dish ownership through the
// hubId derived from restaurantId at the router layer — never trusted from client.

import { prisma } from '../../lib/prisma';
import { ValidationError, NotFoundError, ConflictError } from '../../lib/errors';
import { Prisma } from '@prisma/client';

// ── DTOs ────────────────────────────────────────────────────────────────────────

export interface DishAdminDto {
  id: string;
  categoryId: string;
  name: string;
  subtitle: string | null;
  description: string | null;
  price: string | null;
  tag: string | null;
  dietaryTags: string[];
  availability: string;
  isFeatured: boolean;
  featuredRank: number | null;
  sortOrder: number;
  imageUrl: string | null;
  gradient: string | null;
  isActive: boolean;
  isHidden: boolean;
}

export interface MenuCategoryAdminDto {
  id: string;
  menuId: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  isHidden: boolean;
  dishes: DishAdminDto[];
}

export interface MenuAdminDto {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  categories: MenuCategoryAdminDto[];
}

export interface HubMenuTreeDto {
  menus: MenuAdminDto[];
}

// ── Shapers ─────────────────────────────────────────────────────────────────────

function shapeDish(d: {
  id: string; categoryId: string; name: string; subtitle: string | null;
  description: string | null; price: string | null; tag: string | null;
  dietaryTags: string[]; availability: string;
  isFeatured: boolean; featuredRank: number | null; sortOrder: number;
  imageUrl: string | null; gradient: string | null;
  isActive: boolean; isHidden: boolean;
}): DishAdminDto {
  return {
    id:          d.id,
    categoryId:  d.categoryId,
    name:        d.name,
    subtitle:    d.subtitle,
    description: d.description,
    price:       d.price,
    tag:         d.tag,
    dietaryTags: d.dietaryTags,
    availability: d.availability,
    isFeatured:  d.isFeatured,
    featuredRank: d.featuredRank,
    sortOrder:   d.sortOrder,
    imageUrl:    d.imageUrl,
    gradient:    d.gradient,
    isActive:    d.isActive,
    isHidden:    d.isHidden,
  };
}

function shapeCategory(c: {
  id: string; menuId: string; name: string; description: string | null;
  sortOrder: number; isActive: boolean; isHidden: boolean;
  dishes: Parameters<typeof shapeDish>[0][];
}): MenuCategoryAdminDto {
  return {
    id:          c.id,
    menuId:      c.menuId,
    name:        c.name,
    description: c.description,
    sortOrder:   c.sortOrder,
    isActive:    c.isActive,
    isHidden:    c.isHidden,
    dishes:      c.dishes.map(shapeDish),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────────

const AVAILABILITY_VALUES = new Set([
  'AVAILABLE', 'SOLD_OUT', 'SEASONAL', 'BREAKFAST_ONLY', 'DINNER_ONLY',
]);

function isValidUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch { return false; }
}

function parseNonNegativeInt(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

// Returns the first active menu for a hub, creating a default one if none exists.
async function ensureDefaultMenu(hubId: string): Promise<string> {
  const existing = await prisma.guestHubMenu.findFirst({
    where:   { hubId, isActive: true },
    orderBy: { sortOrder: 'asc' },
    select:  { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.guestHubMenu.create({
    data:   { hubId, name: 'Menu', sortOrder: 0 },
    select: { id: true },
  });
  return created.id;
}

const DISH_ORDER = [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }];
const CAT_ORDER  = [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }];

// ── Category validation ──────────────────────────────────────────────────────────

function validateCategoryFields(body: Record<string, unknown>): {
  errors: Record<string, string[]>;
  name?: string;
  description?: string | null;
  sortOrder?: number;
  isHidden?: boolean;
} {
  const errors: Record<string, string[]> = {};
  const out: { name?: string; description?: string | null; sortOrder?: number; isHidden?: boolean } = {};

  if ('name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name)           errors.name = ['Category name is required'];
    else if (name.length > 80) errors.name = ['Category name must be 80 characters or fewer'];
    else                 out.name = name;
  }

  if ('description' in body) {
    const d = typeof body.description === 'string' ? body.description.trim() : '';
    if (d.length > 300) errors.description = ['Description must be 300 characters or fewer'];
    else                out.description = d || null;
  }

  if ('sortOrder' in body) {
    const n = parseNonNegativeInt(body.sortOrder, -1);
    if (n < 0 || n > 9999) errors.sortOrder = ['Sort order must be between 0 and 9999'];
    else                   out.sortOrder = n;
  }

  if ('isHidden' in body) {
    out.isHidden = Boolean(body.isHidden);
  }

  return { errors, ...out };
}

// ── Dish validation ──────────────────────────────────────────────────────────────

function validateDishFields(body: Record<string, unknown>): {
  errors: Record<string, string[]>;
  name?: string;
  subtitle?: string | null;
  description?: string | null;
  price?: string | null;
  tag?: string | null;
  imageUrl?: string | null;
  gradient?: string | null;
  dietaryTags?: string[];
  availability?: string;
  isFeatured?: boolean;
  featuredRank?: number | null;
  sortOrder?: number;
  isHidden?: boolean;
} {
  const errors: Record<string, string[]> = {};
  const out: {
    name?: string; subtitle?: string | null; description?: string | null;
    price?: string | null; tag?: string | null; imageUrl?: string | null;
    gradient?: string | null; dietaryTags?: string[]; availability?: string;
    isFeatured?: boolean; featuredRank?: number | null;
    sortOrder?: number; isHidden?: boolean;
  } = {};

  if ('name' in body) {
    const v = typeof body.name === 'string' ? body.name.trim() : '';
    if (!v)           errors.name = ['Dish name is required'];
    else if (v.length > 100) errors.name = ['Dish name must be 100 characters or fewer'];
    else              out.name = v;
  }

  if ('subtitle' in body) {
    const v = typeof body.subtitle === 'string' ? body.subtitle.trim() : '';
    if (v.length > 150) errors.subtitle = ['Subtitle must be 150 characters or fewer'];
    else                out.subtitle = v || null;
  }

  if ('description' in body) {
    const v = typeof body.description === 'string' ? body.description.trim() : '';
    if (v.length > 500) errors.description = ['Description must be 500 characters or fewer'];
    else                out.description = v || null;
  }

  if ('price' in body) {
    const v = typeof body.price === 'string' ? body.price.trim() : '';
    if (v.length > 50) errors.price = ['Price must be 50 characters or fewer'];
    else               out.price = v || null;
  }

  if ('tag' in body) {
    const v = typeof body.tag === 'string' ? body.tag.trim() : '';
    if (v.length > 50) errors.tag = ['Tag must be 50 characters or fewer'];
    else               out.tag = v || null;
  }

  if ('imageUrl' in body) {
    const v = typeof body.imageUrl === 'string' ? body.imageUrl.trim() : '';
    if (v && v.length > 500)    errors.imageUrl = ['URL must be 500 characters or fewer'];
    else if (v && !isValidUrl(v)) errors.imageUrl = ['Must be a valid http/https URL'];
    else                          out.imageUrl = v || null;
  }

  if ('gradient' in body) {
    const v = typeof body.gradient === 'string' ? body.gradient.trim() : '';
    if (v.length > 300) errors.gradient = ['Gradient must be 300 characters or fewer'];
    else                out.gradient = v || null;
  }

  if ('dietaryTags' in body) {
    const raw = Array.isArray(body.dietaryTags) ? body.dietaryTags : [];
    if (raw.length > 8) {
      errors.dietaryTags = ['Maximum 8 dietary tags allowed'];
    } else {
      const cleaned = raw
        .filter(t => typeof t === 'string')
        .map(t => (t as string).trim().toLowerCase())
        .filter(t => t.length > 0 && t.length <= 30);
      out.dietaryTags = cleaned;
    }
  }

  if ('availability' in body) {
    const v = typeof body.availability === 'string' ? body.availability.trim().toUpperCase() : '';
    if (!AVAILABILITY_VALUES.has(v)) {
      errors.availability = [`Must be one of: ${[...AVAILABILITY_VALUES].join(', ')}`];
    } else {
      out.availability = v;
    }
  }

  if ('isFeatured' in body) {
    out.isFeatured = Boolean(body.isFeatured);
  }

  if ('featuredRank' in body) {
    const raw = body.featuredRank;
    if (raw === null || raw === '' || raw === undefined) {
      out.featuredRank = null;
    } else {
      const n = parseNonNegativeInt(raw, -1);
      if (n < 0 || n > 999) errors.featuredRank = ['Featured rank must be between 0 and 999'];
      else                   out.featuredRank = n;
    }
  }

  if ('sortOrder' in body) {
    const n = parseNonNegativeInt(body.sortOrder, -1);
    if (n < 0 || n > 9999) errors.sortOrder = ['Sort order must be between 0 and 9999'];
    else                   out.sortOrder = n;
  }

  if ('isHidden' in body) {
    out.isHidden = Boolean(body.isHidden);
  }

  return { errors, ...out };
}

// ── Queries ──────────────────────────────────────────────────────────────────────

export async function getMenuTree(hubId: string): Promise<HubMenuTreeDto> {
  const menus = await prisma.guestHubMenu.findMany({
    where:   { hubId },
    orderBy: { sortOrder: 'asc' },
    include: {
      categories: {
        orderBy: CAT_ORDER,
        include: { dishes: { orderBy: DISH_ORDER } },
      },
    },
  });

  return {
    menus: menus.map(m => ({
      id:         m.id,
      name:       m.name,
      sortOrder:  m.sortOrder,
      isActive:   m.isActive,
      categories: m.categories.map(shapeCategory),
    })),
  };
}

// ── Mutations: categories ────────────────────────────────────────────────────────

export async function createCategory(
  hubId: string,
  body: unknown,
): Promise<MenuCategoryAdminDto> {
  console.log('[DIAG 10a] createCategory called — hubId:', hubId, 'body:', JSON.stringify(body));
  const raw = (body ?? {}) as Record<string, unknown>;
  const { errors, name, description, sortOrder, isHidden } = validateCategoryFields({
    name:        raw.name,
    description: raw.description,
    sortOrder:   raw.sortOrder,
    isHidden:    raw.isHidden,
  });

  if (!('name' in raw) || name === undefined) {
    errors.name = ['Category name is required'];
  }
  if (Object.keys(errors).length > 0) {
    console.error('[DIAG 10b] validation failed — errors:', JSON.stringify(errors));
    throw new ValidationError('Validation failed', { fieldErrors: errors });
  }

  const menuId = await ensureDefaultMenu(hubId);
  console.log('[DIAG 10c] menuId:', menuId, 'name to insert:', name);

  try {
    const created = await prisma.guestHubMenuCategory.create({
      data: {
        menuId,
        name:        name!,
        description: description ?? null,
        sortOrder:   sortOrder ?? 0,
        isHidden:    isHidden ?? false,
      },
      include: { dishes: { orderBy: DISH_ORDER } },
    });
    console.log('[DIAG 10d] prisma.create success — id:', created.id, 'name:', created.name);
    return shapeCategory(created);
  } catch (err) {
    console.error('[DIAG 10e] prisma.create error:', err);
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictError('A category with this name already exists in this menu');
    }
    throw err;
  }
}

export async function updateCategory(
  hubId: string,
  categoryId: string,
  body: unknown,
): Promise<MenuCategoryAdminDto> {
  // Ownership check — category must belong to this hub
  const existing = await prisma.guestHubMenuCategory.findFirst({
    where:  { id: categoryId, menu: { hubId } },
    select: { id: true },
  });
  if (!existing) throw new NotFoundError('Category', categoryId);

  const raw = (body ?? {}) as Record<string, unknown>;
  const { errors, ...fields } = validateCategoryFields(raw);

  if (Object.keys(errors).length > 0) {
    throw new ValidationError('Validation failed', { fieldErrors: errors });
  }

  // Build update only from provided fields
  const data: Prisma.GuestHubMenuCategoryUpdateInput = {};
  if (fields.name        !== undefined) data.name        = fields.name;
  if (fields.description !== undefined) data.description = fields.description;
  if (fields.sortOrder   !== undefined) data.sortOrder   = fields.sortOrder;
  if (fields.isHidden    !== undefined) data.isHidden    = fields.isHidden;

  if (Object.keys(data).length === 0) {
    // Nothing to update — return current state
    const current = await prisma.guestHubMenuCategory.findUniqueOrThrow({
      where:   { id: categoryId },
      include: { dishes: { orderBy: DISH_ORDER } },
    });
    return shapeCategory(current);
  }

  try {
    const updated = await prisma.guestHubMenuCategory.update({
      where:   { id: categoryId },
      data,
      include: { dishes: { orderBy: DISH_ORDER } },
    });
    return shapeCategory(updated);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictError('A category with this name already exists in this menu');
    }
    throw err;
  }
}

// ── Mutations: dishes ────────────────────────────────────────────────────────────

export async function createDish(
  hubId: string,
  categoryId: string,
  body: unknown,
): Promise<DishAdminDto> {
  // Ownership check — category must belong to this hub
  const cat = await prisma.guestHubMenuCategory.findFirst({
    where:  { id: categoryId, menu: { hubId } },
    select: { id: true },
  });
  if (!cat) throw new NotFoundError('Category', categoryId);

  const raw = (body ?? {}) as Record<string, unknown>;
  const { errors, name, ...fields } = validateDishFields({
    name:        raw.name,
    subtitle:    raw.subtitle,
    description: raw.description,
    price:       raw.price,
    tag:         raw.tag,
    imageUrl:    raw.imageUrl,
    gradient:    raw.gradient,
    dietaryTags: raw.dietaryTags,
    availability: raw.availability,
    isFeatured:  raw.isFeatured,
    featuredRank: raw.featuredRank,
    sortOrder:   raw.sortOrder,
    isHidden:    raw.isHidden,
  });

  if (!name) errors.name = ['Dish name is required'];
  if (Object.keys(errors).length > 0) {
    throw new ValidationError('Validation failed', { fieldErrors: errors });
  }

  try {
    const created = await prisma.guestHubDish.create({
      data: {
        categoryId,
        name:         name!,
        subtitle:     fields.subtitle     ?? null,
        description:  fields.description  ?? null,
        price:        fields.price        ?? null,
        tag:          fields.tag          ?? null,
        imageUrl:     fields.imageUrl     ?? null,
        gradient:     fields.gradient     ?? null,
        dietaryTags:  fields.dietaryTags  ?? [],
        availability: (fields.availability ?? 'AVAILABLE') as 'AVAILABLE' | 'SOLD_OUT' | 'SEASONAL' | 'BREAKFAST_ONLY' | 'DINNER_ONLY',
        isFeatured:   fields.isFeatured   ?? false,
        featuredRank: fields.featuredRank ?? null,
        sortOrder:    fields.sortOrder    ?? 0,
        isHidden:     fields.isHidden     ?? false,
      },
    });
    return shapeDish(created);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictError('A dish with this name already exists in this category');
    }
    throw err;
  }
}

export async function updateDish(
  hubId: string,
  categoryId: string,
  dishId: string,
  body: unknown,
): Promise<DishAdminDto> {
  // Ownership check — dish must be in this category, category in this hub
  const existing = await prisma.guestHubDish.findFirst({
    where:  { id: dishId, categoryId, category: { menu: { hubId } } },
    select: { id: true },
  });
  if (!existing) throw new NotFoundError('Dish', dishId);

  const raw = (body ?? {}) as Record<string, unknown>;
  const { errors, ...fields } = validateDishFields(raw);

  if (Object.keys(errors).length > 0) {
    throw new ValidationError('Validation failed', { fieldErrors: errors });
  }

  // Build partial update from only provided fields
  const data: Prisma.GuestHubDishUpdateInput = {};
  if (fields.name        !== undefined) data.name        = fields.name;
  if (fields.subtitle    !== undefined) data.subtitle    = fields.subtitle;
  if (fields.description !== undefined) data.description = fields.description;
  if (fields.price       !== undefined) data.price       = fields.price;
  if (fields.tag         !== undefined) data.tag         = fields.tag;
  if (fields.imageUrl    !== undefined) data.imageUrl    = fields.imageUrl;
  if (fields.gradient    !== undefined) data.gradient    = fields.gradient;
  if (fields.dietaryTags !== undefined) data.dietaryTags = fields.dietaryTags;
  if (fields.availability !== undefined) {
    data.availability = fields.availability as 'AVAILABLE' | 'SOLD_OUT' | 'SEASONAL' | 'BREAKFAST_ONLY' | 'DINNER_ONLY';
  }
  if (fields.isFeatured  !== undefined) data.isFeatured  = fields.isFeatured;
  if (fields.featuredRank !== undefined) data.featuredRank = fields.featuredRank;
  if (fields.sortOrder   !== undefined) data.sortOrder   = fields.sortOrder;
  if (fields.isHidden    !== undefined) data.isHidden    = fields.isHidden;

  if (Object.keys(data).length === 0) {
    // Nothing to update — return current state
    const current = await prisma.guestHubDish.findUniqueOrThrow({ where: { id: dishId } });
    return shapeDish(current);
  }

  try {
    const updated = await prisma.guestHubDish.update({ where: { id: dishId }, data });
    return shapeDish(updated);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictError('A dish with this name already exists in this category');
    }
    throw err;
  }
}
