import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { errorHandler } from "./common/middleware/error-handler.js";
import { logger } from "./config/logger.js";
import authRouter from "./modules/auth/auth.routes.js";
import healthRouter from "./modules/health/health.routes.js";
import usersRouter from "./modules/users/users.routes.js";
import emailRouter from "./modules/email/email.routes.js";

const app = express();

app.use(
  cors({
    origin: process.env.CORS_ORIGIN?.split(",").map((value) => value.trim()) ?? true,
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());

app.use((req, res, next) => {
  const started = Date.now();
  res.on("finish", () => {
    logger.info(
      {
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: Date.now() - started,
      },
      "request",
    );
  });
  next();
});

app.use("/api/health", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/email", emailRouter);

app.use(errorHandler);

export default app;
