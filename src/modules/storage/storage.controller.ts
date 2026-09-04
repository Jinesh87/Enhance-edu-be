import type { NextFunction, Request, Response } from "express";
import {
  buildDirectUploadKey,
  getSignedUploadUrl,
  isBrowserDirectStorageEnabled,
} from "../../common/storage/object-storage.js";
import { assertPresignUploadMeta } from "../../common/validation/validate-upload.js";
import { AppError } from "../../common/errors/AppError.js";

const ALLOWED_PURPOSES = new Set([
  "homework-attachment",
  "homework-submission",
  "session-resource",
  "assessment-resource",
  "assessment-submission",
  "syllabus-document",
]);

class StorageController {
  capabilities = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(200).json({
        directUpload: isBrowserDirectStorageEnabled(),
      });
    } catch (error) {
      next(error);
    }
  };

  presignUpload = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!isBrowserDirectStorageEnabled()) {
        throw new AppError(
          400,
          "Direct upload is not available",
          "DIRECT_UPLOAD_UNAVAILABLE",
        );
      }

      const purpose =
        typeof req.body?.purpose === "string" ? req.body.purpose.trim() : "";
      const fileName =
        typeof req.body?.fileName === "string" ? req.body.fileName.trim() : "";
      const contentType =
        typeof req.body?.contentType === "string"
          ? req.body.contentType.trim()
          : "";
      const byteSize =
        typeof req.body?.byteSize === "number" ? req.body.byteSize : undefined;

      if (!ALLOWED_PURPOSES.has(purpose)) {
        throw new AppError(400, "Invalid upload purpose", "INVALID_PURPOSE");
      }

      const meta = assertPresignUploadMeta({
        originalName: fileName,
        mimeType: contentType,
        size: byteSize,
      });

      const storageKey = buildDirectUploadKey({
        purpose,
        fileName,
        userId: req.user!.id,
      });

      const signed = await getSignedUploadUrl(storageKey, {
        contentType: meta.mimeType,
      });

      res.status(200).json({
        url: signed.url,
        storageKey: signed.storageKey,
        expiresIn: signed.expiresIn,
        contentType: meta.mimeType,
      });
    } catch (error) {
      next(error);
    }
  };
}

export const storageController = new StorageController();
