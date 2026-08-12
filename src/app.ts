import cors from "cors";
import express from "express";
import { logger } from "./config/logger.js";
import healthRouter from "./routes/health.js";
import usersRouter from "./routes/users.js";

const app = express();

app.use(
  cors({
    origin: process.env.CORS_ORIGIN?.split(",") ?? true,
  }),
);
app.use(express.json());

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
app.use("/api/users", usersRouter);

app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    logger.error({ err }, "Unhandled error");
    res.status(500).json({ error: "Internal server error" });
  },
);

export default app;
