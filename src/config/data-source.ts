import "reflect-metadata";
import { DataSource } from "typeorm";
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
  EnrollmentVersion,
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
  await bootstrap.query(`
    ALTER TABLE assessments
      ADD COLUMN IF NOT EXISTS "totalMarks" numeric(8,2);
    ALTER TABLE assessments
      ADD COLUMN IF NOT EXISTS "cutOffMarks" numeric(8,2);
    ALTER TABLE assessment_submissions
      ADD COLUMN IF NOT EXISTS mark numeric(8,2);
    ALTER TABLE assessment_submissions
      ADD COLUMN IF NOT EXISTS "markedAt" timestamptz;
    ALTER TABLE assessment_submissions
      ADD COLUMN IF NOT EXISTS "markedById" uuid;
    ALTER TABLE assessment_submissions
      ADD COLUMN IF NOT EXISTS "markNotes" text;
  `);
  await bootstrap.destroy();
}

export async function ensureEnrollmentStatusSchema() {
  const bootstrap = new DataSource({
    ...postgresOptions(),
    synchronize: false,
    entities: [],
  });
  await bootstrap.initialize();
  const [{ enrollmentsTable }] = await bootstrap.query(`
    SELECT to_regclass('public.enrollments') IS NOT NULL AS "enrollmentsTable"
  `);
  if (!enrollmentsTable) {
    await bootstrap.destroy();
    return;
  }

  await bootstrap.query(`
    UPDATE enrollments
    SET status = 'ACTIVE'
    WHERE status::text IN ('PENDING', 'WITHDRAWN');
  `);

  await bootstrap.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname = 'enrollments_status_enum'
          AND e.enumlabel IN ('PENDING', 'WITHDRAWN')
      ) THEN
        ALTER TYPE enrollments_status_enum RENAME TO enrollments_status_enum_old;
        CREATE TYPE enrollments_status_enum AS ENUM ('ACTIVE', 'AWAITING_GUARDIAN');
        ALTER TABLE enrollments ALTER COLUMN status DROP DEFAULT;
        ALTER TABLE enrollments
          ALTER COLUMN status TYPE enrollments_status_enum
          USING (
            CASE status::text
              WHEN 'ACTIVE' THEN 'ACTIVE'::enrollments_status_enum
              WHEN 'AWAITING_GUARDIAN' THEN 'AWAITING_GUARDIAN'::enrollments_status_enum
              ELSE 'ACTIVE'::enrollments_status_enum
            END
          );
        ALTER TABLE enrollments ALTER COLUMN status SET DEFAULT 'ACTIVE';
        DROP TYPE enrollments_status_enum_old;
      END IF;
    END $$;
  `);
  await bootstrap.destroy();
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
    EnrollmentVersion,
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
