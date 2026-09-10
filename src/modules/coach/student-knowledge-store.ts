import { AppDataSource } from "../../config/data-source.js";
import { logger } from "../../config/logger.js";
import { hasPgVector, cosineSimilarity } from "./embedding-store.js";
import type { StudentKnowledgeSourceType } from "../../entities/StudentKnowledgeChunk.js";

export type StudentKnowledgeHit = {
  id: string;
  studentId: string;
  sourceType: StudentKnowledgeSourceType;
  sourceId: string;
  sourceLabel: string | null;
  content: string;
  occurredOn: string | null;
  score: number;
};

export async function upsertStudentKnowledgeChunk(row: {
  studentId: string;
  sourceType: StudentKnowledgeSourceType;
  sourceId: string;
  sourceLabel: string | null;
  content: string;
  embedding: number[];
  occurredOn?: string | null;
}) {
  const vectorLiteral = `[${row.embedding.join(",")}]`;
  const useVector = await hasPgVector();
  const occurredOn = row.occurredOn ?? null;

  if (useVector) {
    try {
      await AppDataSource.query(
        `
        INSERT INTO student_knowledge_chunks
          ("id", "studentId", "sourceType", "sourceId", "sourceLabel", "content", "occurredOn", "embedding", "embeddingJson", "createdAt", "updatedAt")
        VALUES
          (gen_random_uuid(), $1, $2, $3, $4, $5, $6::date, $7::vector, $8::jsonb, now(), now())
        ON CONFLICT ("studentId", "sourceType", "sourceId")
        DO UPDATE SET
          "sourceLabel" = EXCLUDED."sourceLabel",
          "content" = EXCLUDED."content",
          "occurredOn" = EXCLUDED."occurredOn",
          "embedding" = EXCLUDED."embedding",
          "embeddingJson" = EXCLUDED."embeddingJson",
          "updatedAt" = now()
        `,
        [
          row.studentId,
          row.sourceType,
          row.sourceId,
          row.sourceLabel,
          row.content,
          occurredOn,
          vectorLiteral,
          JSON.stringify(row.embedding),
        ],
      );
      return;
    } catch (error) {
      logger.warn(
        { err: error, studentId: row.studentId, sourceType: row.sourceType },
        "pgvector student knowledge upsert failed; falling back to jsonb",
      );
    }
  }

  await AppDataSource.query(
    `
    INSERT INTO student_knowledge_chunks
      ("id", "studentId", "sourceType", "sourceId", "sourceLabel", "content", "occurredOn", "embeddingJson", "createdAt", "updatedAt")
    VALUES
      (gen_random_uuid(), $1, $2, $3, $4, $5, $6::date, $7::jsonb, now(), now())
    ON CONFLICT ("studentId", "sourceType", "sourceId")
    DO UPDATE SET
      "sourceLabel" = EXCLUDED."sourceLabel",
      "content" = EXCLUDED."content",
      "occurredOn" = EXCLUDED."occurredOn",
      "embeddingJson" = EXCLUDED."embeddingJson",
      "updatedAt" = now()
    `,
    [
      row.studentId,
      row.sourceType,
      row.sourceId,
      row.sourceLabel,
      row.content,
      occurredOn,
      JSON.stringify(row.embedding),
    ],
  );
}

export async function deleteStudentKnowledgeByType(
  studentId: string,
  sourceType: StudentKnowledgeSourceType,
) {
  await AppDataSource.query(
    `
    DELETE FROM student_knowledge_chunks
    WHERE "studentId" = $1 AND "sourceType" = $2
    `,
    [studentId, sourceType],
  );
}

export async function countStudentKnowledgeChunks(
  studentId: string,
): Promise<number> {
  const rows = await AppDataSource.query(
    `
    SELECT COUNT(*)::int AS count
    FROM student_knowledge_chunks
    WHERE "studentId" = $1
    `,
    [studentId],
  );
  return Number(rows[0]?.count ?? 0);
}

export async function retrieveStudentKnowledgeChunks(input: {
  studentId: string;
  embedding: number[];
  limit?: number;
}): Promise<StudentKnowledgeHit[]> {
  const limit = Math.min(20, Math.max(1, input.limit ?? 10));
  const vectorLiteral = `[${input.embedding.join(",")}]`;

  if (await hasPgVector()) {
    try {
      const rows = (await AppDataSource.query(
        `
        SELECT
          "id",
          "studentId",
          "sourceType",
          "sourceId",
          "sourceLabel",
          "content",
          "occurredOn"::text AS "occurredOn",
          1 - ("embedding" <=> $2::vector) AS score
        FROM student_knowledge_chunks
        WHERE "studentId" = $1
          AND "embedding" IS NOT NULL
        ORDER BY "embedding" <=> $2::vector
        LIMIT $3
        `,
        [input.studentId, vectorLiteral, limit],
      )) as Array<StudentKnowledgeHit>;
      return rows.map((row) => ({
        ...row,
        occurredOn: row.occurredOn ?? null,
        score: Number(row.score ?? 0),
      }));
    } catch (error) {
      logger.warn(
        { err: error, studentId: input.studentId },
        "pgvector student knowledge retrieval failed; falling back to jsonb",
      );
    }
  }

  const rows = (await AppDataSource.query(
    `
    SELECT
      "id",
      "studentId",
      "sourceType",
      "sourceId",
      "sourceLabel",
      "content",
      "occurredOn"::text AS "occurredOn",
      "embeddingJson"
    FROM student_knowledge_chunks
    WHERE "studentId" = $1
      AND "embeddingJson" IS NOT NULL
    ORDER BY "updatedAt" DESC
    LIMIT 400
    `,
    [input.studentId],
  )) as Array<
    Omit<StudentKnowledgeHit, "score"> & {
      embeddingJson: number[] | string;
    }
  >;

  return rows
    .map((row) => {
      const values = Array.isArray(row.embeddingJson)
        ? row.embeddingJson
        : (JSON.parse(String(row.embeddingJson)) as number[]);
      return {
        id: row.id,
        studentId: row.studentId,
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        sourceLabel: row.sourceLabel,
        content: row.content,
        occurredOn: row.occurredOn ?? null,
        score: cosineSimilarity(input.embedding, values),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
