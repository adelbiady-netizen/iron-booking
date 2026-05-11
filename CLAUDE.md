# Iron Booking — Claude Code Instructions

## Deployment

This repo has **two separate Vercel projects** that must both be deployed on every production release.

| Directory | Vercel project | Production domain |
|---|---|---|
| `iron-booking/` (root) | `iron-booking` | `www.ironbooking.com` |
| `iron-booking/frontend/` | `frontend` | `frontend-ten-sand-18.vercel.app` |

**Always run both commands when deploying to production:**

```bash
# From the frontend subdirectory
cd frontend && vercel --prod --yes

# From the repo root
cd .. && vercel --prod --yes
```

Both must reach `READY` status. After deploying, confirm both domains serve the same JS bundle filename (e.g. `assets/index-BpcksMNy.js`) by fetching each page and comparing the `<script>` src.

If only one is deployed, `www.ironbooking.com` and the Vercel preview URL will diverge and serve different builds.

## Architecture

- **Frontend**: React + TypeScript + Vite + Tailwind, located in `frontend/`
- **Backend**: Node.js API, located in `backend/`
- Primary working directory for frontend work: `frontend/`

## Operational rules

- **No hard delete in the host UI.** Permanent deletion is admin-only. The `Delete reservation` button must not appear in GuestDrawer or any live operational view.
- TypeScript must pass clean (`npx tsc --noEmit`) before every commit.
