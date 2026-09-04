import { createReadStream, createWriteStream, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { rename } from "fs/promises";
import type { Response } from "express";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { AppError } from "../errors/AppError.js";

export type StoredObject = {
  key: string;
  byteSize: number;
};

const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;
const UPLOAD_URL_TTL_SECONDS = 10 * 60;

export function isRemoteObjectStorage(): boolean {
  return Boolean(
    env.LINODE_OBJECT_STORAGE_ENDPOINT &&
      env.LINODE_OBJECT_STORAGE_BUCKET &&
      env.LINODE_OBJECT_STORAGE_ACCESS_KEY &&
      env.LINODE_OBJECT_STORAGE_SECRET_KEY,
  );
}

export function isBrowserDirectStorageEnabled(): boolean {
  return isRemoteObjectStorage() && env.STORAGE_BROWSER_DIRECT;
}

let s3: S3Client | null = null;

function getS3(): S3Client {
  if (!s3) {
    s3 = new S3Client({
      region: env.LINODE_OBJECT_STORAGE_REGION,
      endpoint: env.LINODE_OBJECT_STORAGE_ENDPOINT,
      forcePathStyle: false,
      credentials: {
        accessKeyId: env.LINODE_OBJECT_STORAGE_ACCESS_KEY,
        secretAccessKey: env.LINODE_OBJECT_STORAGE_SECRET_KEY,
      },
    });
  }
  return s3;
}

function storageFolder(): string {
  return env.STORAGE_FOLDER.trim().replace(/^\/+|\/+$/g, "");
}

/** Logical DB key → S3 object key, with STORAGE_FOLDER prefix when set. */
function remoteKey(key: string): string {
  const folder = storageFolder();
  const trimmed = key.replace(/^\/+/, "");
  if (!folder) return trimmed;
  if (trimmed === folder || trimmed.startsWith(`${folder}/`)) return trimmed;
  return `${folder}/${trimmed}`;
}

function localPathForKey(key: string): string {
  return join(process.cwd(), env.UPLOAD_LOCAL_DIR, key);
}

export async function putObject(params: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<StoredObject> {
  if (isRemoteObjectStorage()) {
    await getS3().send(
      new PutObjectCommand({
        Bucket: env.LINODE_OBJECT_STORAGE_BUCKET,
        Key: remoteKey(params.key),
        Body: params.body,
        ContentType: params.contentType,
      }),
    );
    return { key: params.key, byteSize: params.body.length };
  }

  const path = localPathForKey(params.key);
  mkdirSync(dirname(path), { recursive: true });
  await pipeline(Readable.from(params.body), createWriteStream(path));
  logger.debug({ key: params.key }, "Stored object on local disk (Linode unset)");
  return { key: params.key, byteSize: params.body.length };
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  if (isRemoteObjectStorage()) {
    const result = await getS3().send(
      new GetObjectCommand({
        Bucket: env.LINODE_OBJECT_STORAGE_BUCKET,
        Key: remoteKey(key),
      }),
    );
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) throw new Error(`Empty object for key ${key}`);
    return Buffer.from(bytes);
  }

  const path = localPathForKey(key);
  if (!existsSync(path)) throw new Error(`Missing local object ${key}`);
  const chunks: Buffer[] = [];
  for await (const chunk of createReadStream(path)) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function deleteObject(key: string): Promise<void> {
  if (isRemoteObjectStorage()) {
    await getS3().send(
      new DeleteObjectCommand({
        Bucket: env.LINODE_OBJECT_STORAGE_BUCKET,
        Key: remoteKey(key),
      }),
    );
    return;
  }
  try {
    const { unlink } = await import("fs/promises");
    await unlink(localPathForKey(key));
  } catch {
    /* ignore */
  }
}

export async function objectExists(key: string): Promise<boolean> {
  if (isRemoteObjectStorage()) {
    try {
      await getS3().send(
        new HeadObjectCommand({
          Bucket: env.LINODE_OBJECT_STORAGE_BUCKET,
          Key: remoteKey(key),
        }),
      );
      return true;
    } catch {
      return false;
    }
  }
  return existsSync(localPathForKey(key));
}

/** Short-lived GET URL for private bucket downloads (browser → Linode direct). */
export async function getSignedDownloadUrl(
  key: string,
  options?: {
    expiresIn?: number;
    contentType?: string;
    fileName?: string;
    inline?: boolean;
  },
): Promise<{ url: string; expiresIn: number }> {
  if (!isRemoteObjectStorage()) {
    throw new Error("Signed download requires Linode Object Storage");
  }
  const expiresIn = options?.expiresIn ?? DOWNLOAD_URL_TTL_SECONDS;
  const disposition = options?.fileName
    ? `${options.inline === false ? "attachment" : "inline"}; filename="${encodeURIComponent(options.fileName)}"`
    : undefined;
  const command = new GetObjectCommand({
    Bucket: env.LINODE_OBJECT_STORAGE_BUCKET,
    Key: remoteKey(key),
    ResponseContentType: options?.contentType,
    ResponseContentDisposition: disposition,
  });
  const url = await getSignedUrl(getS3(), command, { expiresIn });
  return { url, expiresIn };
}

/** Short-lived PUT URL for direct browser → Linode uploads. */
export async function getSignedUploadUrl(
  key: string,
  options: { contentType: string; expiresIn?: number },
): Promise<{ url: string; expiresIn: number; storageKey: string }> {
  if (!isRemoteObjectStorage()) {
    throw new Error("Signed upload requires Linode Object Storage");
  }
  const expiresIn = options.expiresIn ?? UPLOAD_URL_TTL_SECONDS;
  const command = new PutObjectCommand({
    Bucket: env.LINODE_OBJECT_STORAGE_BUCKET,
    Key: remoteKey(key),
    ContentType: options.contentType,
  });
  const url = await getSignedUrl(getS3(), command, { expiresIn });
  return { url, expiresIn, storageKey: key };
}

/**
 * Serve a stored file to the client.
 * - Browser-direct (opt-in): JSON `{ url }` signed download (needs Linode CORS).
 * - Default: proxy bytes through the API (works without bucket CORS).
 */
export async function respondWithStoredFile(
  res: Response,
  file: {
    storageKey: string;
    mimeType: string;
    originalName: string;
    inline?: boolean;
  },
): Promise<void> {
  if (isBrowserDirectStorageEnabled()) {
    const signed = await getSignedDownloadUrl(file.storageKey, {
      contentType: file.mimeType,
      fileName: file.originalName,
      inline: file.inline !== false,
    });
    res.status(200).json({
      url: signed.url,
      expiresIn: signed.expiresIn,
      fileName: file.originalName,
      mimeType: file.mimeType,
    });
    return;
  }

  const buffer = await getObjectBuffer(file.storageKey);
  res.setHeader("Content-Type", file.mimeType);
  res.setHeader(
    "Content-Disposition",
    `${file.inline === false ? "attachment" : "inline"}; filename="${encodeURIComponent(file.originalName)}"`,
  );
  res.setHeader("Cache-Control", "private, max-age=60");
  res.status(200).send(buffer);
}

export function buildExamAnswerKey(parts: {
  assessmentId: string;
  studentId: string;
  submissionId: string;
  fileName: string;
}): string {
  const safe = parts.fileName.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
  return `entrance-exams/${parts.assessmentId}/${parts.studentId}/${parts.submissionId}/${Date.now()}-${safe}`;
}

export function buildAssessmentSubmissionKey(parts: {
  assessmentId: string;
  studentId: string;
  submissionId: string;
  fileName: string;
}): string {
  const safe = parts.fileName.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
  return `assessment-submissions/${parts.assessmentId}/${parts.studentId}/${parts.submissionId}/${Date.now()}-${safe}`;
}

export function buildAssessmentResourceKey(parts: {
  assessmentId: string;
  resourceId: string;
  fileName: string;
}): string {
  const safe = parts.fileName.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
  return `assessment-resources/${parts.assessmentId}/${parts.resourceId}/${Date.now()}-${safe}`;
}

export function buildSessionResourceKey(parts: {
  sessionId: string;
  resourceId: string;
  fileName: string;
}): string {
  const safe = parts.fileName.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
  return `session-resources/${parts.sessionId}/${parts.resourceId}/${Date.now()}-${safe}`;
}

export function buildHomeworkAttachmentKey(parts: {
  homeworkId: string;
  attachmentId: string;
  fileName: string;
}): string {
  const safe = parts.fileName.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
  return `homework/${parts.homeworkId}/${parts.attachmentId}/${Date.now()}-${safe}`;
}

export function buildHomeworkSubmissionKey(parts: {
  homeworkId: string;
  studentId: string;
  submissionId: string;
  fileName: string;
}): string {
  const safe = parts.fileName.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
  return `homework-submissions/${parts.homeworkId}/${parts.studentId}/${parts.submissionId}/${Date.now()}-${safe}`;
}

export function buildSyllabusDocumentKey(parts: {
  syllabusId: string;
  documentId: string;
  fileName: string;
}): string {
  const safe = parts.fileName.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
  return `syllabus/${parts.syllabusId}/${parts.documentId}/${Date.now()}-${safe}`;
}

/** Temporary key for direct uploads before DB row id exists. */
export function buildDirectUploadKey(parts: {
  purpose: string;
  fileName: string;
  userId: string;
}): string {
  const safePurpose = parts.purpose
    .replace(/[^a-zA-Z0-9._/-]+/g, "_")
    .slice(0, 80);
  const safeUser = parts.userId.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 64);
  const safe = parts.fileName.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
  return `direct-uploads/${safeUser}/${safePurpose}/${Date.now()}-${safe}`;
}

export function isDirectUploadKey(key: string): boolean {
  return key.startsWith("direct-uploads/") && !key.includes("..");
}

export function assertDirectUploadOwnedBy(key: string, userId: string): void {
  const safeUser = userId.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 64);
  if (!isDirectUploadKey(key) || !key.startsWith(`direct-uploads/${safeUser}/`)) {
    throw new AppError(
      403,
      "Direct upload does not belong to you",
      "FORBIDDEN",
    );
  }
}

/**
 * Move a browser-direct upload into its final storage key.
 * Rejects keys outside `direct-uploads/` (caller must have authenticated).
 */
export async function promoteDirectUpload(params: {
  tempKey: string;
  finalKey: string;
  contentType: string;
}): Promise<void> {
  if (!isDirectUploadKey(params.tempKey)) {
    throw new AppError(400, "Invalid direct upload key", "INVALID_UPLOAD");
  }
  if (!(await objectExists(params.tempKey))) {
    throw new AppError(400, "Direct upload not found", "UPLOAD_MISSING");
  }

  if (isRemoteObjectStorage()) {
    const bucket = env.LINODE_OBJECT_STORAGE_BUCKET;
    const source = remoteKey(params.tempKey);
    await getS3().send(
      new CopyObjectCommand({
        Bucket: bucket,
        CopySource: `${bucket}/${source}`,
        Key: remoteKey(params.finalKey),
        ContentType: params.contentType,
        MetadataDirective: "REPLACE",
      }),
    );
    await deleteObject(params.tempKey);
    return;
  }

  const from = localPathForKey(params.tempKey);
  const to = localPathForKey(params.finalKey);
  mkdirSync(dirname(to), { recursive: true });
  await rename(from, to);
}

/** Put from buffer, or claim a completed direct (presigned) upload. */
export async function storeUploadedObject(params: {
  finalKey: string;
  contentType: string;
  buffer?: Buffer;
  directStorageKey?: string;
  byteSize?: number;
}): Promise<StoredObject> {
  if (params.directStorageKey) {
    await promoteDirectUpload({
      tempKey: params.directStorageKey,
      finalKey: params.finalKey,
      contentType: params.contentType,
    });
    return {
      key: params.finalKey,
      byteSize: params.byteSize ?? params.buffer?.length ?? 0,
    };
  }
  if (!params.buffer) {
    throw new AppError(400, "File data is required", "NO_FILES");
  }
  return putObject({
    key: params.finalKey,
    body: params.buffer,
    contentType: params.contentType,
  });
}

export type IncomingStoredFile = {
  buffer?: Buffer;
  directStorageKey?: string;
  originalName: string;
  mimeType: string;
  size: number;
};

export function resolveIncomingFiles(
  files: Express.Multer.File[] | undefined,
  body: unknown,
  ownerUserId?: string,
): IncomingStoredFile[] {
  const multerFiles = Array.isArray(files) ? files : [];
  if (multerFiles.length > 0) {
    return multerFiles.map((file) => ({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    }));
  }

  const record =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  let raw: unknown = record.directUploads ?? record.files;
  if (typeof raw === "string" && raw.trim()) {
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      throw new AppError(400, "Invalid directUploads payload", "INVALID_UPLOAD");
    }
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    return [];
  }

  return raw.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new AppError(
        400,
        `Invalid direct upload at index ${index}`,
        "INVALID_UPLOAD",
      );
    }
    const row = item as Record<string, unknown>;
    const storageKey =
      typeof row.storageKey === "string" ? row.storageKey.trim() : "";
    const originalName =
      typeof row.originalName === "string" ? row.originalName.trim() : "";
    const mimeType =
      typeof row.mimeType === "string" ? row.mimeType.trim() : "";
    const size =
      typeof row.byteSize === "number"
        ? row.byteSize
        : typeof row.size === "number"
          ? row.size
          : NaN;
    if (!storageKey || !isDirectUploadKey(storageKey)) {
      throw new AppError(400, "Invalid direct upload key", "INVALID_UPLOAD");
    }
    if (ownerUserId) {
      assertDirectUploadOwnedBy(storageKey, ownerUserId);
    }
    if (!originalName || !mimeType || !Number.isFinite(size) || size < 1) {
      throw new AppError(
        400,
        "Direct upload metadata is incomplete",
        "INVALID_UPLOAD",
      );
    }
    return {
      directStorageKey: storageKey,
      originalName,
      mimeType,
      size,
    };
  });
}
