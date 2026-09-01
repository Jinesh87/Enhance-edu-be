import { createReadStream, createWriteStream, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";

export type StoredObject = {
  key: string;
  byteSize: number;
};

function linodeConfigured(): boolean {
  return Boolean(
    env.LINODE_OBJECT_STORAGE_ENDPOINT &&
      env.LINODE_OBJECT_STORAGE_BUCKET &&
      env.LINODE_OBJECT_STORAGE_ACCESS_KEY &&
      env.LINODE_OBJECT_STORAGE_SECRET_KEY,
  );
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

function localPathForKey(key: string): string {
  return join(process.cwd(), env.UPLOAD_LOCAL_DIR, key);
}

export async function putObject(params: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<StoredObject> {
  if (linodeConfigured()) {
    await getS3().send(
      new PutObjectCommand({
        Bucket: env.LINODE_OBJECT_STORAGE_BUCKET,
        Key: params.key,
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
  if (linodeConfigured()) {
    const result = await getS3().send(
      new GetObjectCommand({
        Bucket: env.LINODE_OBJECT_STORAGE_BUCKET,
        Key: key,
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
  if (linodeConfigured()) {
    await getS3().send(
      new DeleteObjectCommand({
        Bucket: env.LINODE_OBJECT_STORAGE_BUCKET,
        Key: key,
      }),
    );
    return;
  }
  // Local deletes are best-effort; ignore missing files.
  try {
    const { unlink } = await import("fs/promises");
    await unlink(localPathForKey(key));
  } catch {
    /* ignore */
  }
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
