# Host App — Operational Settings Hub

Brings routine operational administration into the Host application so managers
don't leave it for the Portal during service. Portal remains the home for
business administration (branding, billing, reports, integrations, operating
hours, subscription, company settings).

Status: **code-complete, unit-proven, not yet field-validated / not deployed.**

## Scope (v1)

A single **Settings** hub (`activePage: 'settings'`) reached from the More-menu
(desktop) and the "הגדרות" section of the mobile More panel. Two live tabs;
Notifications and SMS Templates shown as "Soon".

- **Team** — create / edit / enable-disable / reset-PIN / delete floor staff,
  assign role. This is the pre-existing `HostsSettingsPage`, promoted into the
  hub in `embedded` mode.
- **Online Reservations** — ON/OFF master switch (confirm dialog on OFF) +
  Maximum online party size.

## Permission model (product decision, 2026-07-18)

Two categories of operational action, gated differently:

**Category A — Daily operational controls: open to every authenticated Host user.**
Enable/Disable online reservations, change max online party size. Routine
decisions made during service. Safeguards: confirmation before disabling online
reservations, and full audit.

**Category B — Team management: Restaurant Managers / Owners only.**
Create/edit/reset-PIN/enable-disable/delete host users, change host role. This
is an operational management decision (we don't want every floor host creating
accounts), not primarily a security one. Gate = `requireRole('MANAGER')` on
`/api/hosts` (minimum-level: MANAGER and above; HOST/SERVER excluded). In the UI
the **Team tab is hidden** for users without the permission — non-managers land
on the Online Reservations tab; the hub itself stays open to everyone.

**Anti-escalation invariant** (applies within Team management, unchanged): a user
may not create, assign, or act on a role higher than their own. Enforced
server-side (`assertNotAbove`); mirrored in the UI (role picker filtered, actions
hidden on higher-ranked users).

## Backend

- `lib/onlineSettings.ts` — single source of truth for reading
  `onlineReservationsEnabled` / `maxOnlinePartySize` out of `Restaurant.settings`.
  **Safety invariant: `onlineReservationsEnabled` defaults to TRUE** — an absent
  or legacy key must never disable online booking. Used by both the public
  booking guard and the Host settings endpoint so defaults can't drift.
- `modules/hostSettings/router.ts` (`/api/host-settings`) — authenticated,
  auto-scoped to `req.auth.restaurantId`. `GET`/`PATCH /online-reservations`.
  Never uses the SUPER_ADMIN Portal settings endpoint.
- `modules/public/booking.router.ts` — new master-switch guard in the reserve
  handler: when OFF, returns `ONLINE_RESERVATIONS_CLOSED`. Public guest path
  only — walk-ins and phone reservations use a different router and are
  unaffected; existing reservations are never touched. Max-party takes effect on
  the next booking attempt (settings read fresh per request, no cache).
- `modules/hosts/router.ts` — keeps the `requireRole('MANAGER')` gate (team
  management is Managers/Owners only); added `assertNotAbove` anti-escalation +
  self-disable guard; audits every mutation.
- `lib/hostAudit.ts` — append-only audit via the existing `host_events` table
  (no migration). Fire-and-forget; an audit-write failure never blocks the action.
  Events: `team.host.{created,updated,pin_reset,active_changed,deleted}`,
  `settings.online_reservations.toggled`, `settings.max_online_party_size.changed`.

## Frontend

- `pages/SettingsPage.tsx` — the hub (tabs + toast). Team tab shown only to
  Managers/Owners (`TEAM_ROLES`); non-managers default to the Online tab.
- `pages/OnlineReservationsSettings.tsx` — toggle + max-party panel.
- `pages/HostsSettingsPage.tsx` — added `embedded` prop; role picker + per-row
  actions respect the anti-escalation hierarchy. Rendered only inside the
  (manager-gated) Team tab.
- `components/MobileMorePanel.tsx` — `onSettings` entry under "הגדרות".
- api client: `api.hostSettings.{getOnlineReservations,updateOnlineReservations}`.

## Verification

- `npm run test:online-settings` — 9/9. Proves the money-safety default
  (absent/garbage key → ENABLED; only explicit `false` closes booking).
- `tsc --noEmit` clean (backend + frontend); frontend `vite build` clean.
- **Not done:** live end-to-end against a running stack — deliberately skipped
  because the only reachable DB is the live system. Field/staging validation is
  the required runtime gate before deploy.

## No migration required

Uses existing `Restaurant.settings` JSON keys and the existing `host_events`
table. Nothing to migrate.
