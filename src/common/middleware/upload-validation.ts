import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { AppError } from "../errors/AppError.js";
import { validateUploadBuffer } from "../validation/validate-upload.js";

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
