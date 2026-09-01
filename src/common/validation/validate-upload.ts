import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { AppError } from "../errors/AppError.js";

export type ValidateUploadInput = {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  size: number;
};

export type ValidateUploadResult =
  | { valid: true; mimeType: string }
  | { valid: false; error: string };

// Tune against real student photo samples once in production.
export const SHARPNESS_THRESHOLD = 100;

const MIN_FILE_BYTES = 10 * 1024;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const MIN_IMAGE_WIDTH = 800;
const MIN_IMAGE_HEIGHT = 600;
const MAX_IMAGE_WIDTH = 6000;
const MAX_IMAGE_HEIGHT = 6000;

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/csv",
]);

const BLOCKED_MIME_TYPES = new Set([
  "image/svg+xml",
  "application/zip",
  "application/x-zip-compressed",
  "application/gzip",
  "application/x-msdownload",
  "application/x-msdos-program",
  "application/vnd.microsoft.portable-executable",
  "application/x-executable",
  "application/x-sh",
  "application/x-bat",
]);

const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const UNSUPPORTED_TYPE_MESSAGE =
  "Unsupported file type. Please upload JPG, PNG, PDF, DOCX, CSV, XLS, or XLSX.";

function invalid(error: string): ValidateUploadResult {
  return { valid: false, error };
}

function extensionOf(name: string) {
  const trimmed = name.trim();
  const dot = trimmed.lastIndexOf(".");
  if (dot <= 0 || dot === trimmed.length - 1) return "";
  return trimmed.slice(dot + 1).toLowerCase();
}

function validateFilename(name: string): ValidateUploadResult | null {
  const trimmed = name.trim();
  if (!trimmed || !extensionOf(trimmed)) {
    return invalid("Invalid file name.");
  }
  return null;
}

function resolveMimeType(
  detectedMime: string | undefined,
  originalName: string,
): string | null {
  if (detectedMime && ALLOWED_MIME_TYPES.has(detectedMime)) {
    return detectedMime;
  }

  const extension = extensionOf(originalName);
  switch (extension) {
    case "csv":
      return "text/csv";
    case "xls":
      return "application/vnd.ms-excel";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "pdf":
      return "application/pdf";
    default:
      return detectedMime ?? null;
  }
}
function isBlockedMime(mimeType: string) {
  const normalized = mimeType.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.startsWith("video/")) return true;
  return BLOCKED_MIME_TYPES.has(normalized);
}

function validateSize(size: number, mimeType: string): ValidateUploadResult {
  if (size === 0) {
    return invalid("This file is empty. Please select a valid file.");
  }
  if (size < MIN_FILE_BYTES) {
    return invalid("File is too small/large. Minimum size is 10KB.");
  }

  const isImage = IMAGE_MIME_TYPES.has(mimeType);
  const maxBytes = isImage ? MAX_IMAGE_BYTES : MAX_DOCUMENT_BYTES;
  const maxMb = isImage ? 15 : 20;
  if (size > maxBytes) {
    return invalid(`File is too small/large. Max size is ${maxMb}MB.`);
  }

  return { valid: true, mimeType };
}

function computeLaplacianVariance(data: Uint8Array, width: number, height: number) {
  let sum = 0;
  let sumSquares = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const center = data[index] ?? 0;
      const laplacian =
        -4 * center +
        (data[index - 1] ?? 0) +
        (data[index + 1] ?? 0) +
        (data[index - width] ?? 0) +
        (data[index + width] ?? 0);
      sum += laplacian;
      sumSquares += laplacian * laplacian;
      count += 1;
    }
  }

  if (count === 0) return 0;
  const mean = sum / count;
  return sumSquares / count - mean * mean;
}

async function measureImageSharpness(buffer: Buffer) {
  const { data, info } = await sharp(buffer)
    .rotate()
    .grayscale()
    .resize(640, 640, { fit: "inside", withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });

  return computeLaplacianVariance(data, info.width, info.height);
}

async function validateImage(
  buffer: Buffer,
  mimeType: string,
): Promise<ValidateUploadResult> {
  try {
    const image = sharp(buffer, { failOn: "error" }).rotate();
    const metadata = await image.metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;

    if (width < MIN_IMAGE_WIDTH || height < MIN_IMAGE_HEIGHT) {
      return invalid(
        "Image resolution is too low/high. Please upload a clearer photo.",
      );
    }
    if (width > MAX_IMAGE_WIDTH || height > MAX_IMAGE_HEIGHT) {
      return invalid(
        "Image resolution is too low/high. Please upload a clearer photo.",
      );
    }

    const sharpness = await measureImageSharpness(buffer);
    if (sharpness < SHARPNESS_THRESHOLD) {
      return invalid(
        "This photo looks blurry or shaky. Please retake it steady and in focus.",
      );
    }

    return { valid: true, mimeType };
  } catch {
    return invalid("This file appears to be corrupted. Please try again.");
  }
}

async function validatePdf(buffer: Buffer): Promise<ValidateUploadResult> {
  if (!buffer.subarray(0, 4).equals(Buffer.from("%PDF"))) {
    return invalid("This file appears to be corrupted. Please try again.");
  }
  return { valid: true, mimeType: "application/pdf" };
}

async function validateDocx(buffer: Buffer): Promise<ValidateUploadResult> {
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    return invalid("This file appears to be corrupted. Please try again.");
  }
  return {
    valid: true,
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
}

async function validateXlsx(buffer: Buffer): Promise<ValidateUploadResult> {
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    return invalid("This file appears to be corrupted. Please try again.");
  }
  return {
    valid: true,
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

async function validateXls(buffer: Buffer): Promise<ValidateUploadResult> {
  if (
    !buffer
      .subarray(0, 8)
      .equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
  ) {
    return invalid("This file appears to be corrupted. Please try again.");
  }
  return { valid: true, mimeType: "application/vnd.ms-excel" };
}

async function validateCsv(buffer: Buffer): Promise<ValidateUploadResult> {
  if (buffer.length === 0) {
    return invalid("This file appears to be corrupted. Please try again.");
  }
  if (buffer.includes(0)) {
    return invalid("This file appears to be corrupted. Please try again.");
  }
  const text = buffer.subarray(0, Math.min(buffer.length, 8192)).toString("utf8");
  if (!/[\r\n,;]/.test(text)) {
    return invalid("This file appears to be corrupted. Please try again.");
  }
  return { valid: true, mimeType: "text/csv" };
}

export async function validateUploadBuffer(
  input: ValidateUploadInput,
): Promise<ValidateUploadResult> {
  const filenameError = validateFilename(input.originalName);
  if (filenameError) return filenameError;

  if (isBlockedMime(input.mimeType)) {
    return invalid("Videos and this file type aren't supported here.");
  }

  const detected = await fileTypeFromBuffer(input.buffer);
  const mimeType = resolveMimeType(detected?.mime, input.originalName);
  if (!mimeType || !ALLOWED_MIME_TYPES.has(mimeType)) {
    return invalid(UNSUPPORTED_TYPE_MESSAGE);
  }

  if (isBlockedMime(mimeType)) {
    return invalid("Videos and this file type aren't supported here.");
  }

  const sizeResult = validateSize(input.size, mimeType);
  if (!sizeResult.valid) return sizeResult;

  if (IMAGE_MIME_TYPES.has(mimeType)) {
    const imageResult = await validateImage(input.buffer, mimeType);
    if (!imageResult.valid) return imageResult;
    return { valid: true, mimeType };
  }

  if (mimeType === "application/pdf") {
    const pdfResult = await validatePdf(input.buffer);
    if (!pdfResult.valid) return pdfResult;
    return { valid: true, mimeType };
  }

  if (mimeType === "application/vnd.ms-excel") {
    const xlsResult = await validateXls(input.buffer);
    if (!xlsResult.valid) return xlsResult;
    return { valid: true, mimeType };
  }

  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    const xlsxResult = await validateXlsx(input.buffer);
    if (!xlsxResult.valid) return xlsxResult;
    return { valid: true, mimeType };
  }

  if (mimeType === "text/csv" || mimeType === "application/csv") {
    const csvResult = await validateCsv(input.buffer);
    if (!csvResult.valid) return csvResult;
    return { valid: true, mimeType };
  }

  const docxResult = await validateDocx(input.buffer);
  if (!docxResult.valid) return docxResult;
  return { valid: true, mimeType };
}

export async function assertValidUploadBuffer(input: ValidateUploadInput) {
  const result = await validateUploadBuffer(input);
  if (!result.valid) {
    throw new AppError(400, result.error, "INVALID_UPLOAD");
  }
  return result.mimeType;
}
