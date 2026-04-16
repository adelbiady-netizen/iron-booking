"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
function getEnv(name, fallback) {
    const value = process.env[name] ?? fallback;
    if (value === undefined || value === "") {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}
function getNumberEnv(name, fallback) {
    const raw = process.env[name];
    if (!raw)
        return fallback;
    const parsed = Number(raw);
    if (Number.isNaN(parsed)) {
        throw new Error(`Environment variable ${name} must be a number`);
    }
    return parsed;
}
exports.env = {
    NODE_ENV: process.env.NODE_ENV ?? "development",
    PORT: getNumberEnv("PORT", 3001),
    DATABASE_URL: getEnv("DATABASE_URL", ""),
    CORS_ORIGIN: process.env.CORS_ORIGIN ?? "http://localhost:5173",
    LOG_LEVEL: process.env.LOG_LEVEL ?? "info"
};
exports.default = exports.env;
