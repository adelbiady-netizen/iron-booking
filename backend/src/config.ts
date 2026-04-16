import dotenv from "dotenv";

dotenv.config();

function getEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;

  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be a number`);
  }

  return parsed;
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  PORT: getNumberEnv("PORT", 3001),
  DATABASE_URL: getEnv("DATABASE_URL", ""),
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  LOG_LEVEL: process.env.LOG_LEVEL ?? "info"
};

export default env;