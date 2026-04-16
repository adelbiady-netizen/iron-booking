import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";

import { env } from "./config";
import reservationRoutes from "./routes/reservation.routes";
import tableBoardRoutes from "./routes/tableBoardRoutes";

const app = express();

app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true
  })
);

app.use(helmet());
app.use(express.json());
app.use(morgan("dev"));

app.get("/health", (_req, res) => {
  res.status(200).json({
    success: true,
    service: "iron-booking-api",
    environment: env.NODE_ENV
  });
});

app.get("/api/v1/health", (_req, res) => {
  res.status(200).json({
    success: true,
    service: "iron-booking-api",
    environment: env.NODE_ENV
  });
});

app.use("/api/v1/reservations", reservationRoutes);
app.use("/api/v1/tables", tableBoardRoutes);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`
  });
});

export default app;