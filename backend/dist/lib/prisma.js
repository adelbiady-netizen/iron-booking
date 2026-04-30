"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const client_1 = require("@prisma/client");
const adapter_pg_1 = require("@prisma/adapter-pg");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const globalForPrisma = globalThis;
function makeClient() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error('DATABASE_URL environment variable is not set');
    }
    const adapter = new adapter_pg_1.PrismaPg({ connectionString });
    if (process.env.NODE_ENV === 'development') {
        return new client_1.PrismaClient({ adapter, log: ['warn', 'error'] });
    }
    return new client_1.PrismaClient({ adapter, log: ['error'] });
}
exports.prisma = globalForPrisma.prisma ?? makeClient();
if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = exports.prisma;
}
//# sourceMappingURL=prisma.js.map