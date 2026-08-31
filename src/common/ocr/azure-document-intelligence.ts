import DocumentIntelligence, {
  getLongRunningPoller,
  isUnexpected,
  type AnalyzeOperationOutput,
  type DocumentIntelligenceClient,
} from "@azure-rest/ai-document-intelligence";
import { env } from "../../config/env.js";

const READ_MODEL = "prebuilt-read";

let client: DocumentIntelligenceClient | null = null;

export function isAzureDocumentIntelligenceConfigured(): boolean {
  return Boolean(
    env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT.trim() &&
      env.AZURE_DOCUMENT_INTELLIGENCE_KEY.trim(),
  );
}

function getClient(): DocumentIntelligenceClient {
  if (!isAzureDocumentIntelligenceConfigured()) {
    throw new Error(
      "Azure Document Intelligence is not configured. Set AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_KEY.",
    );
  }
  if (!client) {
    client = DocumentIntelligence(env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT.trim(), {
      key: env.AZURE_DOCUMENT_INTELLIGENCE_KEY.trim(),
    });
  }
  return client;
}

/**
 * Run Azure Document Intelligence Read (OCR / handwriting) on a file buffer.
 */
export async function extractTextWithAzureRead(
  buffer: Buffer,
  options?: { locale?: string },
): Promise<string> {
  const di = getClient();
  const base64Source = buffer.toString("base64");

  const initialResponse = await di
    .path("/documentModels/{modelId}:analyze", READ_MODEL)
    .post({
      contentType: "application/json",
      body: { base64Source },
      queryParameters: options?.locale ? { locale: options.locale } : undefined,
    });

  if (isUnexpected(initialResponse)) {
    const err = initialResponse.body.error;
    const message =
      err?.message ||
      (typeof err === "string" ? err : null) ||
      "Azure Document Intelligence analyze request failed";
    throw new Error(message);
  }

  const poller = getLongRunningPoller(di, initialResponse);
  const result = (await poller.pollUntilDone()).body as AnalyzeOperationOutput;

  if (result.status === "failed") {
    const detail =
      result.error?.message ||
      result.error?.code ||
      "Azure Document Intelligence analysis failed";
    throw new Error(detail);
  }

  const content = result.analyzeResult?.content?.trim() ?? "";
  return content;
}
