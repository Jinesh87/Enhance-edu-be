import { AppDataSource } from "../../config/data-source.js";
import { logger } from "../../config/logger.js";

let cachedHasVector: boolean | null = null;

export async function hasPgVector(): Promise<boolean> {
  if (cachedHasVector != null) return cachedHasVector;
  try {
    const rows = await AppDataSource.query(`
      SELECT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'vector'
      ) AS "exists"
    `);
    cachedHasVector = Boolean(rows[0]?.exists);
  } catch {
    cachedHasVector = false;
  }
  return Boolean(cachedHasVector);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function insertChunkWithEmbedding(row: {
  syllabusId: string;
  subjectId: string;
  documentId: string | null;
  sourceType: string;
  sourceLabel: string | null;
  chunkIndex: number;
  content: string;
  embedding: number[];
}) {
  const vectorLiteral = `[${row.embedding.join(",")}]`;
  const useVector = await hasPgVector();

  if (useVector) {
    try {
      await AppDataSource.query(
        `
        INSERT INTO syllabus_chunks
          ("id", "syllabusId", "subjectId", "documentId", "sourceType", "sourceLabel", "chunkIndex", "content", "embedding", "embeddingJson", "createdAt", "updatedAt")
        VALUES
          (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8::vector, $9::jsonb, now(), now())
        `,
        [
          row.syllabusId,
          row.subjectId,
          row.documentId,
          row.sourceType,
          row.sourceLabel,
          row.chunkIndex,
          row.content,
          vectorLiteral,
          JSON.stringify(row.embedding),
        ],
      );
      return;
    } catch (error) {
      logger.warn(
        { err: error },
        "pgvector insert failed; falling back to embeddingJson",
      );
    }
  }

  await AppDataSource.query(
    `
    INSERT INTO syllabus_chunks
      ("id", "syllabusId", "subjectId", "documentId", "sourceType", "sourceLabel", "chunkIndex", "content", "embeddingJson", "createdAt", "updatedAt")
    VALUES
      (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8::jsonb, now(), now())
    `,
    [
      row.syllabusId,
      row.subjectId,
      row.documentId,
      row.sourceType,
      row.sourceLabel,
      row.chunkIndex,
      row.content,
      JSON.stringify(row.embedding),
    ],
  );
}
