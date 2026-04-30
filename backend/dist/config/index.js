"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
function optional(key, fallback) {
    return process.env[key] ?? fallback;
}
exports.config = {
    nodeEnv: optional('NODE_ENV', 'development'),
    port: parseInt(optional('PORT', '3001'), 10),
    jwtSecret: optional('JWT_SECRET', 'iron-booking-dev-secret-change-in-prod'),
    jwtExpiresIn: optional('JWT_EXPIRES_IN', '8h'),
    databaseUrl: optional('DATABASE_URL', ''),
    corsOrigin: optional('CORS_ORIGIN', 'http://localhost:5173'),
    // Business rule defaults (overridden per-restaurant via settings JSON)
    defaultTurnMinutes: 90,
    bufferBetweenTurnsMinutes: 15,
    maxPartySizeAbsolute: 30,
};
//# sourceMappingURL=index.js.map