import type { NextFunction, Request, Response } from "express";
import { logger } from "../../config/logger.js";
import { AppError } from "../errors/AppError.js";
import { writeAuditLog } from "../utils/audit-log.js";

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ err }, err.message);
    }

    if (err.statusCode === 403) {
      void writeAuditLog({
        actorUserId: req.user?.id,
        actorName: req.user?.email,
        action: "DENIED",
        recordType: "account",
        recordId: req.user?.id,
        recordLabel: req.originalUrl,
        after: {
          path: req.originalUrl,
          method: req.method,
          reason: err.code,
        },
      });
    }

    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    });
    return;
  }

  logger.error({ err }, "Unhandled error");
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    },
  });
}
