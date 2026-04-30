"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const config_1 = require("./config");
const errorHandler_1 = require("./middleware/errorHandler");
const router_1 = __importDefault(require("./modules/auth/router"));
const router_2 = __importDefault(require("./modules/reservations/router"));
const router_3 = __importDefault(require("./modules/tables/router"));
const router_4 = __importDefault(require("./modules/waitlist/router"));
const router_5 = __importDefault(require("./modules/guests/router"));
const router_6 = __importDefault(require("./modules/analytics/router"));
const app = (0, express_1.default)();
// ─── Security & Logging ──────────────────────────────────────────────────────
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({
    origin: config_1.config.corsOrigin,
    credentials: true,
}));
app.use((0, morgan_1.default)(config_1.config.nodeEnv === 'development' ? 'dev' : 'combined'));
app.use(express_1.default.json({ limit: '1mb' }));
// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', env: config_1.config.nodeEnv, timestamp: new Date().toISOString() });
});
// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/auth', router_1.default);
app.use('/api/reservations', router_2.default);
app.use('/api/tables', router_3.default);
app.use('/api/waitlist', router_4.default);
app.use('/api/guests', router_5.default);
app.use('/api/analytics', router_6.default);
// ─── 404 ─────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
});
// ─── Error Handler ────────────────────────────────────────────────────────────
app.use(errorHandler_1.errorHandler);
exports.default = app;
//# sourceMappingURL=app.js.map