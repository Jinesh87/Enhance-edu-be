import { AppDataSource } from "../../config/data-source.js";
import { logger } from "../../config/logger.js";
import { embedTexts } from "../../common/ai/openai-client.js";
import { getObjectBuffer } from "../../common/storage/object-storage.js";
import {
  enqueueSessionLessonIndex,
  enqueueSessionResourceIndex,
} from "../../common/queues/session-resource-ingest-queue.js";
import { insertSessionResourceChunkWithEmbedding } from "./embedding-store.js";
import {
  Session,
  SessionLesson,
  SessionResource,
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

async function extractResourceText(
  resource: SessionResource,
): Promise<string | null> {
  const mime = (resource.mimeType || "").toLowerCase();
  const name = resource.originalName.toLowerCase();
  const buffer = await getObjectBuffer(resource.storageKey);

  if (mime.includes("pdf") || name.endsWith(".pdf")) {
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
      resourceId: resource.id,
      mimeType: resource.mimeType,
      originalName: resource.originalName,
    },
    "Skipping session resource — unsupported type for text extraction",
  );
  return null;
}

type PendingChunk = {
  sessionId: string;
  classId: string;
  resourceId: string | null;
  sourceType: "document" | "lesson";
  sourceLabel: string | null;
  chunkIndex: number;
  content: string;
};

async function insertChunks(chunks: PendingChunk[]) {
  if (chunks.length === 0) return;

  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH);
    const embeddings = await embedTexts(
      batch.map((row) => row.content),
      {
        feature: "session_resource_embed",
        metadata: {
          batchSize: batch.length,
          sessionId: batch[0]?.sessionId,
        },
      },
    );

    for (let j = 0; j < batch.length; j++) {
      const row = batch[j]!;
      await insertSessionResourceChunkWithEmbedding({
        sessionId: row.sessionId,
        classId: row.classId,
        resourceId: row.resourceId,
        sourceType: row.sourceType,
        sourceLabel: row.sourceLabel,
        chunkIndex: row.chunkIndex,
        content: row.content,
        embedding: embeddings[j]!,
      });
    }
  }
}

export class SessionResourceIngestService {
  private readonly sessions = AppDataSource.getRepository(Session);
  private readonly resources = AppDataSource.getRepository(SessionResource);
  private readonly lessons = AppDataSource.getRepository(SessionLesson);

  async deleteChunksForResource(resourceId: string) {
    await AppDataSource.query(
      `DELETE FROM session_resource_chunks WHERE "resourceId" = $1`,
      [resourceId],
    );
  }

  async deleteLessonChunksForSession(sessionId: string) {
    await AppDataSource.query(
      `
      DELETE FROM session_resource_chunks
      WHERE "sessionId" = $1 AND "sourceType" = 'lesson'
      `,
      [sessionId],
    );
  }

  async indexResource(resourceId: string) {
    const resource = await this.resources.findOne({
      where: { id: resourceId },
    });
    if (!resource) return;

    const session = await this.sessions.findOne({
      where: { id: resource.sessionId },
      select: { id: true, classId: true },
    });
    if (!session?.classId) return;

    await this.deleteChunksForResource(resourceId);

    let text: string | null = null;
    try {
      text = await extractResourceText(resource);
    } catch (error) {
      logger.warn(
        { err: error, resourceId },
        "Failed to extract session resource text",
      );
      return;
    }
    if (!text) return;

    const label = resource.title || resource.originalName;
    const labeled = [
      `Study notes: ${label}`,
      resource.description ? `Description: ${resource.description}` : null,
      text,
    ]
      .filter(Boolean)
      .join("\n");

    const pending: PendingChunk[] = chunkText(labeled).map(
      (content, index) => ({
        sessionId: resource.sessionId,
        classId: session.classId!,
        resourceId: resource.id,
        sourceType: "document" as const,
        sourceLabel: label,
        chunkIndex: index,
        content,
      }),
    );

    try {
      await insertChunks(pending);
      logger.info(
        { resourceId, chunkCount: pending.length },
        "Session resource indexed for student coach RAG",
      );
    } catch (error) {
      logger.warn(
        { err: error, resourceId },
        "Failed to embed session resource chunks",
      );
      throw error;
    }
  }

  async indexLesson(sessionId: string) {
    const session = await this.sessions.findOne({
      where: { id: sessionId },
      select: { id: true, classId: true },
    });
    if (!session?.classId) return;

    const lesson = await this.lessons.findOne({ where: { sessionId } });
    await this.deleteLessonChunksForSession(sessionId);
    if (!lesson) return;

    const lessonText = [
      `Lesson: ${lesson.title}`,
      lesson.description ? `Description: ${lesson.description}` : null,
      lesson.objectives ? `Objectives: ${lesson.objectives}` : null,
      lesson.sequence ? `Sequence: ${lesson.sequence}` : null,
      lesson.watchFor ? `Watch for: ${lesson.watchFor}` : null,
      lesson.notes ? `Teacher notes: ${lesson.notes}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const pending: PendingChunk[] = chunkText(lessonText).map(
      (content, index) => ({
        sessionId,
        classId: session.classId!,
        resourceId: null,
        sourceType: "lesson" as const,
        sourceLabel: lesson.title,
        chunkIndex: index,
        content,
      }),
    );

    if (pending.length === 0) return;

    try {
      await insertChunks(pending);
      logger.info(
        { sessionId, chunkCount: pending.length },
        "Session lesson notes indexed for student coach RAG",
      );
    } catch (error) {
      logger.warn(
        { err: error, sessionId },
        "Failed to embed session lesson chunks",
      );
      throw error;
    }
  }

  scheduleIndexResource(resourceId: string) {
    void enqueueSessionResourceIndex(resourceId).catch((error) => {
      logger.warn(
        { err: error, resourceId },
        "Failed to enqueue session resource index",
      );
    });
  }

  scheduleIndexLesson(sessionId: string) {
    void enqueueSessionLessonIndex(sessionId).catch((error) => {
      logger.warn(
        { err: error, sessionId },
        "Failed to enqueue session lesson index",
      );
    });
  }
}

export const sessionResourceIngestService = new SessionResourceIngestService();
