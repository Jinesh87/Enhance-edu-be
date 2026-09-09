import { PDFParse } from "pdf-parse";
import {
  extractTextWithAzureRead,
  isAzureDocumentIntelligenceConfigured,
} from "../../common/ocr/azure-document-intelligence.js";
import { AppError } from "../../common/errors/AppError.js";
import {
  LEARNING_MAX_SOURCE_CHARS,
  LEARNING_MIN_EXTRACTED_CHARS,
} from "../../common/constants/learning.js";
import { logger } from "../../config/logger.js";

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncateForGeneration(text: string): {
  text: string;
  truncated: boolean;
} {
  if (text.length <= LEARNING_MAX_SOURCE_CHARS) {
    return { text, truncated: false };
  }
  return {
    text: text.slice(0, LEARNING_MAX_SOURCE_CHARS),
    truncated: true,
  };
}

async function extractWithPdfParse(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  return cleanText(result.text ?? "");
}

/**
 * Extract text from typed or handwritten PDFs.
 * Prefer pdf-parse for digital PDFs; fall back to Azure Read OCR when text is thin
 * (scanned / handwritten) or when forceOcr is set.
 */
export async function extractLearningPdfText(
  buffer: Buffer,
  options?: { forceOcr?: boolean; originalName?: string },
): Promise<{
  text: string;
  truncated: boolean;
  method: "pdf-parse" | "azure-ocr" | "pdf-parse+azure-ocr";
}> {
  let digitalText = "";
  try {
    digitalText = await extractWithPdfParse(buffer);
  } catch (error) {
    logger.warn(
      { err: error, name: options?.originalName },
      "pdf-parse failed for learning source",
    );
  }

  const needsOcr =
    options?.forceOcr === true ||
    digitalText.length < LEARNING_MIN_EXTRACTED_CHARS;

  if (!needsOcr) {
    const capped = truncateForGeneration(digitalText);
    return { ...capped, method: "pdf-parse" };
  }

  if (!isAzureDocumentIntelligenceConfigured()) {
    if (digitalText.length >= LEARNING_MIN_EXTRACTED_CHARS) {
      const capped = truncateForGeneration(digitalText);
      return { ...capped, method: "pdf-parse" };
    }
    throw new AppError(
      400,
      digitalText
        ? "This PDF has very little readable text. Handwritten or scanned PDFs need Azure Document Intelligence OCR configured."
        : "Could not read text from this PDF. For handwritten or scanned notes, configure Azure Document Intelligence OCR.",
      "PDF_EXTRACTION_FAILED",
    );
  }

  try {
    const ocrText = cleanText(await extractTextWithAzureRead(buffer));
    const combined =
      digitalText.length >= LEARNING_MIN_EXTRACTED_CHARS
        ? cleanText(`${digitalText}\n${ocrText}`)
        : ocrText;

    if (combined.length < LEARNING_MIN_EXTRACTED_CHARS) {
      throw new AppError(
        400,
        "Unable to extract enough text from this PDF. Please upload a clearer typed or handwritten PDF.",
        "PDF_EMPTY",
      );
    }

    const capped = truncateForGeneration(combined);
    return {
      ...capped,
      method:
        digitalText.length >= LEARNING_MIN_EXTRACTED_CHARS
          ? "pdf-parse+azure-ocr"
          : "azure-ocr",
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.warn({ err: error }, "Azure OCR failed for learning source");
    throw new AppError(
      400,
      "Unable to process this PDF. Please try another file.",
      "PDF_EXTRACTION_FAILED",
    );
  }
}
