import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config';
import { errorHandler } from './middleware/errorHandler';

import authRouter from './modules/auth/router';
import reservationsRouter from './modules/reservations/router';
import tablesRouter from './modules/tables/router';
import waitlistRouter from './modules/waitlist/router';
import guestsRouter from './modules/guests/router';
import analyticsRouter from './modules/analytics/router';
import adminRouter from './modules/admin/router';
import publicRouter from './modules/public/router';
import linkRouter   from './modules/integrations/link.router';
import eventsRouter from './modules/integrations/events.router';
import hostsRouter    from './modules/hosts/router';
import guestHubRouter      from './modules/guestHub/router';
import guestHubAdminRouter from './modules/guestHub/adminRouter';
import callLogsRouter      from './modules/calls/router';
import smsRouter           from './modules/sms/router';
import intelligenceRouter  from './modules/intelligence/router';

const app = express();

// ─── Request trace (before everything else) ───────────────────────────────────
// SSE paths are excluded — their URLs carry JWT tokens in the query string.
app.use((req, _res, next) => {
  if (!req.path.startsWith('/api/integrations/events')) {
    console.log(`[REQ] ${req.method} ${req.path} — origin: ${req.headers.origin ?? '(none)'}`);
  }
  next();
});

app.use(helmet());

const allowedOrigins = [
  'http://localhost:5173',
  'https://ironbooking.com',
  'https://www.ironbooking.com',
  'https://portal.ironbooking.com', // dedicated management-portal domain
  'https://portal.iron-pos.com',    // iron-pos management-portal domain
];

// Dynamically add FRONTEND_BASE_URL so the guest confirmation page can reach the API
if (config.frontendBaseUrl && !allowedOrigins.includes(config.frontendBaseUrl)) {
  allowedOrigins.push(config.frontendBaseUrl);
}

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.warn('[CORS] Rejected origin:', origin, '| Allowed:', allowedOrigins);
        callback(new Error('Not allowed by CORS: ' + origin));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Skip Morgan access logging for the SSE endpoint — its URL carries a JWT in the query string.
app.use(morgan(config.nodeEnv === 'development' ? 'dev' : 'combined', {
  skip: (req) => req.path.startsWith('/api/integrations/events'),
}));
// Link telephony webhooks may send a form-encoded body with the wrong (or missing)
// Content-Type, causing express.json() to reject it with entity.parse.failed.
// body-parser skips parsing when req.body is already set, so mounting text/urlencoded
// parsers for this path BEFORE the global JSON parser prevents the 400 rejection.
app.use('/api/integrations/link', express.text({ type: '*/*' }));
app.use('/api/integrations/link', express.urlencoded({ extended: false }));

app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    env: config.nodeEnv,
    commit: process.env.RENDER_GIT_COMMIT ?? 'local',
    timestamp: new Date().toISOString(),
  });
});

// Unauthenticated smoke-test — confirms server process is alive
app.get('/api/test', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.use('/api/auth', authRouter);
app.use('/api/reservations', reservationsRouter);
app.use('/api/tables', tablesRouter);
app.use('/api/waitlist', waitlistRouter);
app.use('/api/guests', guestsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/public',              publicRouter);
app.use('/api/integrations/link',   linkRouter);
app.use('/api/integrations/events', eventsRouter);
app.use('/api/hosts',               hostsRouter);
app.use('/api/public/hub',          guestHubRouter);
app.use('/api/admin/hub',           guestHubAdminRouter);
app.use('/api/call-logs',           callLogsRouter);
app.use('/api/sms',                 smsRouter);
app.use('/api/restaurants/:restaurantId/intelligence', intelligenceRouter);

app.use((_req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'Route not found',
    },
  });
});

app.use(errorHandler);

export default app;