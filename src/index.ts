import "reflect-metadata";
import http from "node:http";
import { env } from "./config/env.js";
import app from "./app.js";
import {
  AppDataSource,
  ensureAssessmentSessionSchema,
  ensureSessionLessonSchema,
  ensureAuditSchema,
  ensureEnrollmentStatusSchema,
  ensureHomeworkSchema,
  ensureInstitutionSettingSchema,
  ensureClassScheduleIndexes,
  ensureNotificationSchema,
  ensureOpenAiUsageSchema,
  ensureCoachSchema,
  ensureAdminAiSchema,
  ensureEnquiryConstraints,
  ensureLearningSchema,
  ensureChatSchema,
} from "./config/data-source.js";
import { logger } from "./config/logger.js";
import { connectRedis } from "./config/redis.js";
import { seedSuperAdmin } from "./seeder/seed-super-admin.js";
import { seedEnquiryCatalogue } from "./seeder/seed-enquiry-catalogue.js";
import { adminTasksService } from "./modules/admin/tasks/admin-tasks.service.js";
import { adminAssessmentsService } from "./modules/admin/assessments/admin-assessments.service.js";
import { startOcrWorker } from "./common/queues/ocr-queue.js";
import { startSyllabusIngestWorker } from "./common/queues/syllabus-ingest-queue.js";
import { startSessionResourceIngestWorker } from "./common/queues/session-resource-ingest-queue.js";
import { startBulkActionsWorker } from "./common/queues/bulk-actions-queue.js";
import { startBriefingsWorker } from "./common/queues/briefings-queue.js";
import { attachChatSocket } from "./modules/shared/chat/chat-socket.js";
import { repairChatMessageMediaLinks } from "./modules/shared/chat/repair-chat-media.js";

const port = env.PORT;
const ABSENCE_CHASE_SYNC_MS = 60_000;
const ASSESSMENT_STATUS_SYNC_MS = 60_000;

async function bootstrap() {
  await ensureAuditSchema();
  await ensureAssessmentSessionSchema();
  await ensureSessionLessonSchema();
  await ensureEnrollmentStatusSchema();
  await ensureInstitutionSettingSchema();
  await ensureHomeworkSchema();
  await ensureClassScheduleIndexes();
  await ensureNotificationSchema();
  await ensureOpenAiUsageSchema();
  await AppDataSource.initialize();
  logger.info("Database connected");
  await ensureCoachSchema();
  await ensureAdminAiSchema();
  await ensureLearningSchema();
  await ensureChatSchema();
  await repairChatMessageMediaLinks().catch((error) => {
    logger.warn({ err: error }, "Chat media repair skipped");
  });
  await seedEnquiryCatalogue();
  await ensureEnquiryConstraints();

  await connectRedis();
  await seedSuperAdmin();
  startOcrWorker();
  startSyllabusIngestWorker();
  startSessionResourceIngestWorker();
  startBulkActionsWorker();
  startBriefingsWorker();

  const server = http.createServer(app);
  attachChatSocket(server);

  server.listen(port, "0.0.0.0", () => {
    logger.info({ port }, "API listening");
  });

  const syncAbsenceChases = () => {
    void adminTasksService.syncAbsenceChaseTasks().catch((error) => {
      logger.warn({ err: error }, "Absence chase sync failed");
    });
  };

  syncAbsenceChases();
  const syncTimer = setInterval(syncAbsenceChases, ABSENCE_CHASE_SYNC_MS);
  syncTimer.unref();

  const syncAssessmentStatuses = () => {
    void adminAssessmentsService.syncAssessmentStatuses().catch((error) => {
      logger.warn({ err: error }, "Assessment status sync failed");
    });
  };

  syncAssessmentStatuses();
  const assessmentStatusTimer = setInterval(
    syncAssessmentStatuses,
    ASSESSMENT_STATUS_SYNC_MS,
  );
  assessmentStatusTimer.unref();
}

bootstrap().catch((error) => {
  logger.fatal({ err: error }, "Failed to start server");
  process.exit(1);
});
