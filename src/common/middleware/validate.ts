import type { NextFunction, Request, Response } from "express";
import type { ObjectSchema } from "joi";
import { AppError } from "../errors/AppError.js";

type RequestPart = "body" | "query" | "params";

export function validate(schema: ObjectSchema, part: RequestPart = "body") {
  return (req: Request, _res: Response, next: NextFunction) => {
    const { error, value } = schema.validate(req[part], {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      next(
        new AppError(400, "Validation failed", "VALIDATION_ERROR", {
          details: error.details.map((detail) => ({
            message: detail.message,
            path: detail.path,
          })),
        }),
      );
      return;
    }

    // Express 5: req.query / req.params are getter-only; body is still assignable.
    if (part === "body") {
      req.body = value;
    } else {
      Object.defineProperty(req, part, {
        value,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }

    next();
  };
}
