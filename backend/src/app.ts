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

const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'https://ironbooking.com',
  'https://www.ironbooking.com',
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      callback(new Error('Not allowed by CORS'));
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