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

    // Only sign-in denials belong in change history as "Sign-in".
    // Module/role 403s are expected for scoped staff and must not look like failed logins.
    if (
      err.statusCode === 403 &&
      (err.code === "DEACTIVATED" || err.code === "INVITATION_PENDING")
    ) {
      void writeAuditLog({
        actorUserId: req.user?.id,
        actorName: req.user?.email,
        action: "DENIED",
        recordType: "account",
        recordId: req.user?.id,
        recordLabel: req.user?.email ?? "Unknown",
        after: {
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
