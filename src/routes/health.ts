import { Router } from "express";
import { AppDataSource } from "../config/data-source.js";

const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  const dbOk = AppDataSource.isInitialized;

  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? "ok" : "degraded",
    service: "edu-backend",
    database: dbOk ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
  });
});

export default healthRouter;
