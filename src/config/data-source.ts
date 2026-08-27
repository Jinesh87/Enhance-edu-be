import "reflect-metadata";
import { DataSource, In, IsNull } from "typeorm";
import {
  RefreshToken,
  User,
  Class,
  Session,
  ClassStudent,
  Assessment,
  AssessmentStudent,
  AssessmentSubmission,
  AssessmentSubmissionFile,
  AssessmentResource,
  AttendanceRecord,
  ScanEvent,
  Task,
  Subject,
  Term,
  Student,
  GuardianStudent,
  Enrollment,
  EnrollmentSubject,
  PendingEnrollment,
  PendingEnrollmentSubject,
  TeacherSubject,
  AcademicYear,
  YearLevel,
  InstitutionSetting,
  Holiday,
  Classroom,
  AuditChange,
  Enquiry,
  EnquiryCompetitor,
  EnquiryEvent,
  EnquiryLossReason,
  EnquirySource,
  EnquiryStage,
  EnquiryStageHistory,
} from "../entities/index.js";
import { MessagingConfig } from "../entities/EmailConfig.js";
import { env } from "./env.js";
import {
  DEFAULT_CLASS_TIMEZONE,
  parseDayTime,
} from "../common/utils/timezone.js";

function postgresOptions() {
  return {
    type: "postgres" as const,
    host: env.DB_HOST,
    port: env.DB_PORT,
    username: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
  };
}

export async function ensureAuditSchema() {
  const bootstrap = new DataSource({
    ...postgresOptions(),
    synchronize: false,
    entities: [],
  });
  await bootstrap.initialize();
  await bootstrap.query("CREATE SCHEMA IF NOT EXISTS audit");
  await bootstrap.query(`
    DO $$ BEGIN
      ALTER TYPE users_role_enum ADD VALUE IF NOT EXISTS 'OFFICE_STAFF';
    EXCEPTION
      WHEN undefined_object THEN NULL;
      WHEN duplicate_object THEN NULL;
    END $$;
  `);
  await bootstrap.destroy();
}

/**
 * Backward-compatible schema bootstrap for assessment roll sessions.
 *
 * The project currently has no tracked TypeORM migrations, so this keeps
 * existing production databases compatible when synchronize is disabled.
 */
export async function ensureAssessmentSessionSchema() {
  const bootstrap = new DataSource({
    ...postgresOptions(),
    synchronize: false,
    entities: [],
  });
  await bootstrap.initialize();
  const [{ sessionsTable, assessmentsTable }] = await bootstrap.query(`
    SELECT
      to_regclass('public.sessions') IS NOT NULL AS "sessionsTable",
      to_regclass('public.assessments') IS NOT NULL AS "assessmentsTable"
  `);
  if (!sessionsTable || !assessmentsTable) {
    await bootstrap.destroy();
    return;
  }
  await bootstrap.query(`
    ALTER TABLE assessments
      ADD COLUMN IF NOT EXISTS "scheduleType" varchar(20) NOT NULL DEFAULT 'SESSION';
    ALTER TABLE sessions
      ALTER COLUMN "classId" DROP NOT NULL;
    ALTER TABLE sessions
      ADD COLUMN IF NOT EXISTS "assessmentId" uuid;
    ALTER TABLE sessions
      ADD COLUMN IF NOT EXISTS "teacherId" uuid;
    CREATE UNIQUE INDEX IF NOT EXISTS "UQ_sessions_assessmentId"
      ON sessions ("assessmentId")
      WHERE "assessmentId" IS NOT NULL;
    CREATE TABLE IF NOT EXISTS assessment_resources (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "assessmentId" uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
      "uploadedById" uuid REFERENCES users(id) ON DELETE SET NULL,
      "storageKey" varchar(500) NOT NULL,
      "originalName" varchar(255) NOT NULL,
      "mimeType" varchar(120) NOT NULL,
      "byteSize" integer NOT NULL DEFAULT 0,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS "IDX_assessment_resources_assessmentId"
      ON assessment_resources ("assessmentId");
    CREATE INDEX IF NOT EXISTS "IDX_assessment_resources_uploadedById"
      ON assessment_resources ("uploadedById");
    DO $$ BEGIN
      ALTER TABLE sessions
        ADD CONSTRAINT "FK_sessions_assessmentId"
        FOREIGN KEY ("assessmentId") REFERENCES assessments(id)
        ON DELETE CASCADE;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;
  `);
  await bootstrap.destroy();
}

/**
 * Repairs class schedules created with the browser's local timezone before
 * the school timetable was standardized on Sydney wall-clock time.
 *
 * Session rows are retained and their timestamps are corrected in place so
 * existing attendance and task history keeps the same session identity.
 */
export async function repairLegacyClassScheduleTimezones() {
  if (!AppDataSource.isInitialized) return;

  const classRepo = AppDataSource.getRepository(Class);
  const legacyClasses = await classRepo.find({
    where: { timeZone: In(["Asia/Calcutta", "Asia/Kolkata"]) },
  });
  if (legacyClasses.length === 0) return;

  await AppDataSource.transaction(async (manager) => {
    const transactionClasses = manager.getRepository(Class);
    const transactionSessions = manager.getRepository(Session);

    for (const legacyClass of legacyClasses) {
      const current = await transactionClasses.findOneBy({
        id: legacyClass.id,
      });
      if (!current) continue;

      const schedule = parseDayTime(
        current.dayTime,
        DEFAULT_CLASS_TIMEZONE,
      );
      current.timeZone = DEFAULT_CLASS_TIMEZONE;
      await transactionClasses.save(current);

      if (!schedule) continue;
      const sessions = await transactionSessions.find({
        where: {
          classId: current.id,
          assessmentId: IsNull(),
        },
      });
      for (const session of sessions) {
        session.startAt = schedule.startAt;
        session.endAt = schedule.endAt;
        session.room = current.room || null;
        session.classroomId = current.classroomId;
      }
      if (sessions.length > 0) {
        await transactionSessions.save(sessions);
      }
    }
  });
}

export async function ensureEnquiryConstraints() {
  if (!AppDataSource.isInitialized) return;
  await AppDataSource.query(`
    CREATE OR REPLACE FUNCTION prevent_enquiry_first_source_update()
    RETURNS trigger AS $$
    BEGIN
      IF NEW.first_source_id IS DISTINCT FROM OLD.first_source_id THEN
        RAISE EXCEPTION 'first_source_id is immutable'
          USING ERRCODE = 'restrict_violation';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await AppDataSource.query(`
    DROP TRIGGER IF EXISTS enquiry_first_source_immutable ON enquiries;
  `);
  await AppDataSource.query(`
    CREATE TRIGGER enquiry_first_source_immutable
    BEFORE UPDATE ON enquiries
    FOR EACH ROW
    EXECUTE PROCEDURE prevent_enquiry_first_source_update();
  `);
}

export const AppDataSource = new DataSource({
  ...postgresOptions(),
  synchronize: env.DB_SYNC === "true" || env.NODE_ENV !== "production",
  logging: false,
  entities: [
    User,
    RefreshToken,
    MessagingConfig,
    Class,
    Session,
    ClassStudent,
    Assessment,
    AssessmentStudent,
    AssessmentSubmission,
    AssessmentSubmissionFile,
    AssessmentResource,
    AttendanceRecord,
    ScanEvent,
    Task,
    Subject,
    Term,
    Student,
    GuardianStudent,
    Enrollment,
    EnrollmentSubject,
    PendingEnrollment,
    PendingEnrollmentSubject,
    TeacherSubject,
    AcademicYear,
    YearLevel,
    InstitutionSetting,
    Holiday,
    Classroom,
    AuditChange,
    EnquiryStage,
    EnquirySource,
    EnquiryLossReason,
    EnquiryCompetitor,
    Enquiry,
    EnquiryStageHistory,
    EnquiryEvent,
  ],
  migrations: [],
  subscribers: [],
});
