/**
 * Marks student login accounts as sandbox when their guardian was created via sandbox.
 *
 *   npm run build
 *   npm run backfill-sandbox-students -- --confirm
 */
import "reflect-metadata";
import { AppDataSource } from "../config/data-source.js";
import { logger } from "../config/logger.js";

function wantsConfirm(): boolean {
  return (
    process.argv.includes("--confirm") ||
    process.env.BACKFILL_SANDBOX_STUDENTS_CONFIRM === "yes"
  );
}

async function main(): Promise<void> {
  if (!wantsConfirm()) {
    console.error(
      "Refusing to run without confirmation.\n" +
        "Use: npm run backfill-sandbox-students -- --confirm\n" +
        "Or set BACKFILL_SANDBOX_STUDENTS_CONFIRM=yes",
    );
    process.exit(1);
  }

  await AppDataSource.initialize();
  try {
    const result = (await AppDataSource.query(`
      UPDATE users AS student_user
      SET "createdViaSandbox" = true
      FROM guardian_students gs
      INNER JOIN users AS guardian ON guardian.id = gs."guardianId"
      INNER JOIN students s ON s.id = gs."studentId"
      WHERE student_user.id = s."userId"
        AND guardian."createdViaSandbox" = true
        AND student_user.role = 'STUDENT'
        AND student_user."createdViaSandbox" = false
    `)) as { rowCount?: number } | [unknown, number];

    const updated = Array.isArray(result)
      ? Number(result[1] ?? 0)
      : Number(result?.rowCount ?? 0);
    logger.info({ updated }, "Sandbox flag backfilled for linked student accounts");
  } finally {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
}

main().catch((error) => {
  logger.error({ err: error }, "Failed to backfill sandbox students");
  process.exit(1);
});
