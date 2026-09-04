import { AppDataSource } from "../../config/data-source.js";
import { logger } from "../../config/logger.js";
import { embedTexts } from "../../common/ai/openai-client.js";
import { getObjectBuffer } from "../../common/storage/object-storage.js";
import {
  enqueueSyllabusDocumentIndex,
  enqueueSyllabusReindex,
} from "../../common/queues/syllabus-ingest-queue.js";
import { insertChunkWithEmbedding } from "./embedding-store.js";
import {
  Syllabus,
  SyllabusChunk,
  SyllabusDocument,
} from "../../entities/index.js";
import { PDFParse } from "pdf-parse";

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 200;
const EMBED_BATCH = 32;

function chunkText(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(normalized.length, start + CHUNK_SIZE);
    const slice = normalized.slice(start, end).trim();
    if (slice) chunks.push(slice);
    if (end >= normalized.length) break;
    start = Math.max(0, end - CHUNK_OVERLAP);
  }
  return chunks;
}

async function extractDocumentText(
  document: SyllabusDocument,
): Promise<string | null> {
  const mime = (document.mimeType || "").toLowerCase();
  const name = document.originalName.toLowerCase();
  const buffer = await getObjectBuffer(document.storageKey);

  if (
    mime.includes("pdf") ||
    name.endsWith(".pdf")
  ) {
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    return (result.text ?? "").trim() || null;
  }

  if (
    mime.startsWith("text/") ||
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".csv")
  ) {
    return buffer.toString("utf8").trim() || null;
  }

  logger.warn(
    {
      documentId: document.id,
      mimeType: document.mimeType,
      originalName: document.originalName,
    },
    "Skipping syllabus document — unsupported type for text extraction",
  );
  return null;
}

type PendingChunk = {
  syllabusId: string;
  subjectId: string;
  documentId: string | null;
  sourceType: SyllabusChunk["sourceType"];
  sourceLabel: string | null;
  chunkIndex: number;
  content: string;
};

async function insertChunks(chunks: PendingChunk[]) {
  if (chunks.length === 0) return;

  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH);
    const embeddings = await embedTexts(batch.map((row) => row.content));

    for (let j = 0; j < batch.length; j++) {
      const row = batch[j]!;
      await insertChunkWithEmbedding({
        syllabusId: row.syllabusId,
        subjectId: row.subjectId,
        documentId: row.documentId,
        sourceType: row.sourceType,
        sourceLabel: row.sourceLabel,
        chunkIndex: row.chunkIndex,
        content: row.content,
        embedding: embeddings[j]!,
      });
    }
  }
}

export class SyllabusIngestService {
  private readonly syllabi = AppDataSource.getRepository(Syllabus);
  private readonly documents = AppDataSource.getRepository(SyllabusDocument);

  async deleteChunksForSyllabus(syllabusId: string) {
    await AppDataSource.query(
      `DELETE FROM syllabus_chunks WHERE "syllabusId" = $1`,
      [syllabusId],
    );
  }

  async deleteChunksForDocument(documentId: string) {
    await AppDataSource.query(
      `DELETE FROM syllabus_chunks WHERE "documentId" = $1`,
      [documentId],
    );
  }

  async reindexSyllabus(syllabusId: string) {
    const syllabus = await this.syllabi.findOne({
      where: { id: syllabusId },
      relations: { documents: true, skills: true },
    });
    if (!syllabus) return;

    await this.deleteChunksForSyllabus(syllabusId);

    const pending: PendingChunk[] = [];

    const titleBits = [
      `Syllabus: ${syllabus.title}`,
      syllabus.overview ? `Overview: ${syllabus.overview}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    for (const [index, content] of chunkText(titleBits).entries()) {
      pending.push({
        syllabusId: syllabus.id,
        subjectId: syllabus.subjectId,
        documentId: null,
        sourceType: syllabus.overview ? "overview" : "title",
        sourceLabel: syllabus.title,
        chunkIndex: index,
        content,
      });
    }

    const skills = [...(syllabus.skills ?? [])].sort(
      (a, b) => a.sortOrder - b.sortOrder,
    );
    for (const skill of skills) {
      const skillText = [
        `Skill: ${skill.name}`,
        skill.weightage != null ? `Weightage: ${skill.weightage}` : null,
        skill.description ? `Description: ${skill.description}` : null,
      ]
        .filter(Boolean)
        .join("\n");
      for (const [index, content] of chunkText(skillText).entries()) {
        pending.push({
          syllabusId: syllabus.id,
          subjectId: syllabus.subjectId,
          documentId: null,
          sourceType: "skill",
          sourceLabel: skill.name,
          chunkIndex: index,
          content,
        });
      }
    }

    for (const document of syllabus.documents ?? []) {
      try {
        const text = await extractDocumentText(document);
        if (!text) continue;
        const labeled = `Document: ${document.originalName}\n${text}`;
        for (const [index, content] of chunkText(labeled).entries()) {
          pending.push({
            syllabusId: syllabus.id,
            subjectId: syllabus.subjectId,
            documentId: document.id,
            sourceType: "document",
            sourceLabel: document.originalName,
            chunkIndex: index,
            content,
          });
        }
      } catch (error) {
        logger.warn(
          { err: error, documentId: document.id },
          "Failed to extract syllabus document text",
        );
      }
    }

    try {
      await insertChunks(pending);
      logger.info(
        { syllabusId, chunkCount: pending.length },
        "Syllabus reindexed for coach RAG",
      );
    } catch (error) {
      logger.warn(
        { err: error, syllabusId },
        "Failed to embed syllabus chunks — check OpenAI key and pgvector",
      );
      throw error;
    }
  }

  async indexDocument(documentId: string) {
    const document = await this.documents.findOne({
      where: { id: documentId },
    });
    if (!document) return;

    await this.deleteChunksForDocument(documentId);

    let text: string | null = null;
    try {
      text = await extractDocumentText(document);
    } catch (error) {
      logger.warn(
        { err: error, documentId },
        "Failed to extract syllabus document text",
      );
      return;
    }
    if (!text) return;

    const labeled = `Document: ${document.originalName}\n${text}`;
    const pending: PendingChunk[] = chunkText(labeled).map((content, index) => ({
      syllabusId: document.syllabusId,
      subjectId: "", // filled below
      documentId: document.id,
      sourceType: "document" as const,
      sourceLabel: document.originalName,
      chunkIndex: index,
      content,
    }));

    const syllabus = await this.syllabi.findOne({
      where: { id: document.syllabusId },
      select: { id: true, subjectId: true },
    });
    if (!syllabus) return;
    for (const row of pending) row.subjectId = syllabus.subjectId;

    try {
      await insertChunks(pending);
      logger.info(
        { documentId, chunkCount: pending.length },
        "Syllabus document indexed for coach RAG",
      );
    } catch (error) {
      logger.warn(
        { err: error, documentId },
        "Failed to embed document chunks",
      );
      throw error;
    }
  }

  /** Fire-and-forget via BullMQ so uploads stay fast and work retries. */
  scheduleReindex(syllabusId: string) {
    void enqueueSyllabusReindex(syllabusId).catch((error) => {
      logger.warn(
        { err: error, syllabusId },
        "Failed to enqueue syllabus reindex",
      );
    });
  }

  scheduleIndexDocument(documentId: string) {
    void enqueueSyllabusDocumentIndex(documentId).catch((error) => {
      logger.warn(
        { err: error, documentId },
        "Failed to enqueue document index",
      );
    });
  }

  async enqueueReindex(syllabusId: string) {
    await enqueueSyllabusReindex(syllabusId);
  }
}

export const syllabusIngestService = new SyllabusIngestService();
