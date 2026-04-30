import dotenv from 'dotenv';

dotenv.config();

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const config = {
  nodeEnv: optional('NODE_ENV', 'development'),
  port: parseInt(optional('PORT', '3001'), 10),
  jwtSecret: optional('JWT_SECRET', 'iron-booking-dev-secret-change-in-prod'),
  jwtExpiresIn: optional('JWT_EXPIRES_IN', '8h'),
  databaseUrl: optional('DATABASE_URL', ''),

  corsOrigin: optional('CORS_ORIGIN', 'http://localhost:5173'),
  publicBaseUrl: optional('PUBLIC_BASE_URL', 'http://localhost:3001'),

  // Business rule defaults (overridden per-restaurant via settings JSON)
  defaultTurnMinutes: 90,
  bufferBetweenTurnsMinutes: 15,
  maxPartySizeAbsolute: 30,
} as const;
