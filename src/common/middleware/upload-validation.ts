import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { AppError } from "../errors/AppError.js";
import {
  validateChatAttachmentBuffer,
  validateUploadBuffer,
} from "../validation/validate-upload.js";

export const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 20 },
});

export async function validateUploadedFiles(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    const files = Array.isArray(req.files) ? req.files : [];
    for (const file of files) {
      const result = await validateUploadBuffer({
        buffer: file.buffer,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
      });
      if (!result.valid) {
        throw new AppError(400, result.error, "INVALID_UPLOAD");
      }
    }
    next();
  } catch (error) {
    next(error);
  }
}

export async function validateUploadedChatAttachments(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length > 1) {
      throw new AppError(
        400,
        "Only one file can be sent at a time",
        "INVALID_UPLOAD",
      );
    }
    for (const file of files) {
      const result = await validateChatAttachmentBuffer({
        buffer: file.buffer,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
      });
      if (!result.valid) {
        throw new AppError(400, result.error, "INVALID_UPLOAD");
      }
      file.mimetype = result.mimeType;
    }
    next();
  } catch (error) {
    next(error);
  }
}

/** @deprecated Use validateUploadedChatAttachments */
export const validateUploadedChatImages = validateUploadedChatAttachments;
