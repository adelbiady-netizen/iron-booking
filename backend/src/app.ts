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

const app = express();

app.use(helmet());

const allowedOrigins = [
  'http://localhost:5173',
  'https://ironbooking.com',
  'https://www.ironbooking.com',
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
        callback(new Error('Not allowed by CORS: ' + origin));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

app.use(morgan(config.nodeEnv === 'development' ? 'dev' : 'combined'));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    env: config.nodeEnv,
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/auth', authRouter);
app.use('/api/reservations', reservationsRouter);
app.use('/api/tables', tablesRouter);
app.use('/api/waitlist', waitlistRouter);
app.use('/api/guests', guestsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/public', publicRouter);

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