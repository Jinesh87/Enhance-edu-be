import "dotenv/config";

export const env = {
  PORT: Number(process.env.PORT ?? 3000),
  NODE_ENV: process.env.NODE_ENV ?? "development",
  FRONTEND_URL: process.env.FRONTEND_URL ?? "https://localhost:5173",
  QR_SECRET: process.env.QR_SECRET ?? "enhance-edu-qr-secret-key-2026",
  QR_ROTATION_WINDOW_MS: Number(process.env.QR_ROTATION_WINDOW_MS ?? 30_000),
  LOG_LEVEL: process.env.LOG_LEVEL,
  SEED_SUPER_ADMIN_EMAIL: process.env.SEED_SUPER_ADMIN_EMAIL ?? "superadmin@example.com",
  SEED_SUPER_ADMIN_PASSWORD: process.env.SEED_SUPER_ADMIN_PASSWORD ?? "Superadmin@123",
  SEED_SUPER_ADMIN_NAME: process.env.SEED_SUPER_ADMIN_NAME ?? "Super Admin",
  CORS_ORIGIN: process.env.CORS_ORIGIN,
  DB_HOST: process.env.DB_HOST ?? "localhost",
  DB_PORT: Number(process.env.DB_PORT ?? 5432),
  DB_USER: process.env.DB_USER ?? "edu",
  DB_PASSWORD: process.env.DB_PASSWORD ?? "edu",
  DB_NAME: process.env.DB_NAME ?? "edu",
  DB_SYNC: process.env.DB_SYNC,
  REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN ?? "15m",
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN ?? "7d",
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  /** Linode Object Storage (S3-compatible). Falls back to local ./uploads when unset. */
  LINODE_OBJECT_STORAGE_ENDPOINT: process.env.LINODE_OBJECT_STORAGE_ENDPOINT ?? "",
  LINODE_OBJECT_STORAGE_REGION: process.env.LINODE_OBJECT_STORAGE_REGION ?? "ap-south-1",
  LINODE_OBJECT_STORAGE_BUCKET: process.env.LINODE_OBJECT_STORAGE_BUCKET ?? "",
  LINODE_OBJECT_STORAGE_ACCESS_KEY: process.env.LINODE_OBJECT_STORAGE_ACCESS_KEY ?? "",
  LINODE_OBJECT_STORAGE_SECRET_KEY: process.env.LINODE_OBJECT_STORAGE_SECRET_KEY ?? "",
  /** Optional prefix inside the bucket, e.g. "enhance". Empty = bucket root. */
  STORAGE_FOLDER: process.env.STORAGE_FOLDER ?? "",
  UPLOAD_LOCAL_DIR: process.env.UPLOAD_LOCAL_DIR ?? "uploads",
  STORAGE_BROWSER_DIRECT:
    (process.env.STORAGE_BROWSER_DIRECT ?? "").toLowerCase() === "true",
  /** Azure AI Document Intelligence (OCR / handwriting). Required for entrance-exam OCR. */
  AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT:
    process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT ?? "",
  AZURE_DOCUMENT_INTELLIGENCE_KEY:
    process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY ?? "",
  /** Max files OCR'd in parallel within one submission. */
  OCR_FILE_CONCURRENCY: Math.max(
    1,
    Number(process.env.OCR_FILE_CONCURRENCY ?? 4) || 4,
  ),
  /** Max entrance-exam OCR jobs processed in parallel by the worker. */
  OCR_WORKER_CONCURRENCY: Math.max(
    1,
    Number(process.env.OCR_WORKER_CONCURRENCY ?? 3) || 3,
  ),
  /** Max syllabus ingest (embed) jobs processed in parallel by the worker. */
  SYLLABUS_INGEST_WORKER_CONCURRENCY: Math.max(
    1,
    Number(process.env.SYLLABUS_INGEST_WORKER_CONCURRENCY ?? 2) || 2,
  ),
};
