# Multi-Branch / HQ Architecture

**Status:** Planned — not yet implemented.
**Priority:** Core requirement; must be designed into every new schema or auth change.

---

## Overview

Iron Booking must support restaurant groups where a single HQ account manages multiple branches. All data remains branch-isolated by default. HQ-privileged users can switch between branches from inside the app. Users without HQ access are locked to their assigned branch.

---

## Role Hierarchy

| Role | Scope | Can do |
|---|---|---|
| `SUPER_ADMIN` | Platform | Full access to all restaurants, groups, users |
| `HQ_ADMIN` | Group | View and manage all branches in their group |
| `BRANCH_MANAGER` | Single branch | Full management of their assigned branch |
| `HOST` | Single branch | Operational access (floor, reservations, waitlist) |
| `SERVER` | Single branch | Read-only or limited operational access |

> Current `ADMIN` role maps to `BRANCH_MANAGER` in this model.
> `HQ_ADMIN` is a new role that sits between `SUPER_ADMIN` and `BRANCH_MANAGER`.

---

## Data Model Changes Required

### New: `RestaurantGroup` table

```
RestaurantGroup {
  id          String   @id
  name        String
  slug        String   @unique
  createdAt   DateTime
}
```

### Modified: `Restaurant` table

Add optional group membership:

```
Restaurant {
  ...existing fields...
  groupId     String?
  group       RestaurantGroup? @relation(...)
}
```

A restaurant with no `groupId` behaves exactly as today (standalone).

### Modified: `User` table

Users may be assigned to a group (HQ) or to a specific branch:

```
User {
  ...existing fields...
  restaurantId  String?   // null for HQ_ADMIN users
  groupId       String?   // set for HQ_ADMIN; null for branch-scoped users
  role          UserRole
}
```

Rules:
- `SUPER_ADMIN`: `restaurantId = null`, `groupId = null`
- `HQ_ADMIN`: `restaurantId = null`, `groupId = <group>`
- `BRANCH_MANAGER` / `HOST` / `SERVER`: `restaurantId = <branch>`, `groupId = null`

---

## Auth & Permission Logic

### JWT payload

Extend the JWT to carry the user's scope:

```ts
{
  sub: userId,
  role: 'HQ_ADMIN' | 'BRANCH_MANAGER' | 'HOST' | ...,
  restaurantId: string | null,   // null for HQ_ADMIN / SUPER_ADMIN
  groupId: string | null,        // set for HQ_ADMIN
}
```

### API middleware changes

Every branch-scoped endpoint (`/reservations`, `/tables`, `/waitlist`, etc.) must:

1. Read `restaurantId` from the request context (JWT or explicit `X-Branch-Id` header).
2. If caller is `SUPER_ADMIN` — allow any `restaurantId`.
3. If caller is `HQ_ADMIN` — verify the target restaurant belongs to their `groupId`.
4. If caller is `BRANCH_MANAGER` / `HOST` — verify `restaurantId` matches their assigned branch exactly.
5. Reject with `403` otherwise.

The `X-Branch-Id` header lets HQ users explicitly select a branch without re-authenticating.

---

## Frontend Changes Required

### Branch selector / switcher

**Single-branch user (HOST, BRANCH_MANAGER):**
- No selector shown; app opens directly to their branch.
- Existing behavior, unchanged.

**Multi-branch user (HQ_ADMIN, SUPER_ADMIN):**
- On login, if the user's scope covers > 1 branch → show **Branch Selector screen** before the dashboard.
- Branch selector lists all accessible branches (name, location, live stats if available).
- Selected branch is stored in React context + `sessionStorage` so page refreshes restore it.
- A **branch switcher** (e.g., dropdown in the TopBar, next to the brand name) lets HQ users switch without logging out.

### Branch context

A new `BranchContext` / `useBranch()` hook holds:

```ts
{
  restaurantId: string;
  restaurantName: string;
  slug: string;
  timezone: string;
  // ...any other branch-specific settings
}
```

Every API call that is branch-scoped reads `restaurantId` from this context (or sends `X-Branch-Id` header).

### Switching branch reloads

When the active branch changes, the following must be invalidated and re-fetched:

- Floor tables + layout
- Reservations (for the selected date)
- Waitlist
- Floor objects
- Restaurant settings (turn duration, slot interval, late thresholds, etc.)
- WhatsApp / confirmation language setting (if branch-specific)
- Insights / ActionBar

React Query or equivalent: clear the query cache keyed to the previous `restaurantId`, then re-fetch with the new one.

---

## Data Isolation Guarantees

- Every Prisma query that touches reservation/table/waitlist data **must** include `WHERE restaurantId = ?`.
- The middleware enforces this at the HTTP layer, but service functions must also enforce it defensively.
- No cross-branch data leakage is permitted except for `SUPER_ADMIN` reads.
- Group-level aggregates (e.g., HQ dashboard showing occupancy across all branches) are a separate read path that explicitly joins via `groupId`.

---

## Migration Path

When implementing:

1. Add `RestaurantGroup` table and `groupId` FK on `Restaurant`. All existing restaurants get `groupId = null` (standalone). **Non-breaking.**
2. Add `groupId` column to `User`. All existing users get `groupId = null`. **Non-breaking.**
3. Add `HQ_ADMIN` to the `UserRole` enum in Prisma and Zod schemas.
4. Update JWT signing to include `groupId`.
5. Update auth middleware to handle `HQ_ADMIN` scope checks.
6. Add `X-Branch-Id` header support to branch-scoped endpoints.
7. Frontend: add `BranchContext`, branch selector screen, and TopBar switcher.
8. Frontend: make all API calls branch-context-aware.

Steps 1–2 can be shipped as a no-op migration at any time. Steps 3–8 must ship together.

---

## Open Questions (to resolve before implementation)

- **Group-level settings:** Do groups have shared settings (e.g., brand name, WhatsApp template) or is everything per-branch?
- **Billing:** Is billing per-group or per-branch?
- **Cross-branch guest profiles:** Should a guest who visited Branch A also appear in Branch B's CRM?
- **HQ reporting:** What aggregate views does HQ need (occupancy, no-show rate, covers per branch)?
- **Branch creation:** Can HQ_ADMIN create new branches, or is that SUPER_ADMIN only?
