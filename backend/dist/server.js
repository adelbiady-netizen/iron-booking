"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = __importDefault(require("./app"));
const config_1 = require("./config");
const prisma_1 = require("./lib/prisma");
async function main() {
    // 🔥 BOOT TIMESTAMP — if you don't see this after saving, nodemon did not restart
    console.log('🔥 SERVER BOOTED AT', new Date().toISOString());
    // Verify DB connection before accepting traffic
    await prisma_1.prisma.$connect();
    console.log('[DB] Connected');
    const server = app_1.default.listen(config_1.config.port);
    server.on('error', (err) => {
        console.error('[Fatal] Failed to start server:', err.message);
        process.exit(1);
    });
    server.on('listening', () => {
        console.log(`[Iron Booking] Server running on port ${config_1.config.port} (${config_1.config.nodeEnv})`);
        console.log('🔥 SERVER LISTENING');
    });
    // Graceful shutdown
    const shutdown = async (signal) => {
        console.log(`[${signal}] Shutting down...`);
        server.close(async () => {
            await prisma_1.prisma.$disconnect();
            console.log('[DB] Disconnected');
            process.exit(0);
        });
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}
main().catch((err) => {
    console.error('[Fatal]', err);
    process.exit(1);
});
//# sourceMappingURL=server.js.map