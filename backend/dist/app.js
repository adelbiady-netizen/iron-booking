"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const config_1 = require("./config");
const reservation_routes_1 = __importDefault(require("./routes/reservation.routes"));
const tableBoardRoutes_1 = __importDefault(require("./routes/tableBoardRoutes"));
const app = (0, express_1.default)();
app.use((0, cors_1.default)({
    origin: config_1.env.CORS_ORIGIN,
    credentials: true
}));
app.use((0, helmet_1.default)());
app.use(express_1.default.json());
app.use((0, morgan_1.default)("dev"));
app.get("/health", (_req, res) => {
    res.status(200).json({
        success: true,
        service: "iron-booking-api",
        environment: config_1.env.NODE_ENV
    });
});
app.get("/api/v1/health", (_req, res) => {
    res.status(200).json({
        success: true,
        service: "iron-booking-api",
        environment: config_1.env.NODE_ENV
    });
});
app.use("/api/v1/reservations", reservation_routes_1.default);
app.use("/api/v1/tables", tableBoardRoutes_1.default);
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: `Route not found: ${req.method} ${req.originalUrl}`
    });
});
exports.default = app;
