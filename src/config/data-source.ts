import "reflect-metadata";
import { DataSource } from "typeorm";
import {
  RefreshToken,
  User,
  Class,
  Session,
  SessionLesson,
  SessionResource,
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
  Homework,
  HomeworkAttachment,
  HomeworkStudent,
  HomeworkSubmission,
  HomeworkSubmissionFile,
  Syllabus,
  SyllabusDocument,
  SyllabusSkill,
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
    ALTER TABLE assessments
      ADD COLUMN IF NOT EXISTS "autoMarking" boolean NOT NULL DEFAULT false;
    ALTER TABLE assessments
      ADD COLUMN IF NOT EXISTS "timeZone" varchar(80);
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

export async function ensureSessionLessonSchema() {
  const bootstrap = new DataSource({
    ...postgresOptions(),
    synchronize: false,
    entities: [],
  });
  await bootstrap.initialize();
  const [{ sessionsTable }] = await bootstrap.query(`
    SELECT to_regclass('public.sessions') IS NOT NULL AS "sessionsTable"
  `);
  if (!sessionsTable) {
    await bootstrap.destroy();
    return;
  }
  await bootstrap.query(`
    CREATE TABLE IF NOT EXISTS session_lessons (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "sessionId" uuid NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
      "title" varchar(200) NOT NULL,
      "description" text,
      "objectives" text,
      "sequence" text,
      "watchFor" text,
      "notes" text,
      "updatedById" uuid REFERENCES users(id) ON DELETE SET NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS "IDX_session_lessons_sessionId"
      ON session_lessons ("sessionId");
    CREATE TABLE IF NOT EXISTS session_resources (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "sessionId" uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      "uploadedById" uuid REFERENCES users(id) ON DELETE SET NULL,
      "title" varchar(255) NOT NULL,
      "description" text,
      "storageKey" varchar(500) NOT NULL,
      "originalName" varchar(255) NOT NULL,
      "mimeType" varchar(120) NOT NULL,
      "byteSize" integer NOT NULL DEFAULT 0,
      "sortOrder" integer NOT NULL DEFAULT 0,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS "IDX_session_resources_sessionId"
      ON session_resources ("sessionId");
    CREATE INDEX IF NOT EXISTS "IDX_session_resources_uploadedById"
      ON session_resources ("uploadedById");
  `);
  await bootstrap.destroy();
}

export async function ensureInstitutionSettingSchema() {
  const bootstrap = new DataSource({
    ...postgresOptions(),
    synchronize: false,
    entities: [],
  });
  await bootstrap.initialize();
  const [{ institutionSettingTable }] = await bootstrap.query(`
    SELECT to_regclass('public.institution_setting') IS NOT NULL AS "institutionSettingTable"
  `);
  if (!institutionSettingTable) {
    await bootstrap.destroy();
    return;
  }

  await bootstrap.query(`
    ALTER TABLE institution_setting
      ADD COLUMN IF NOT EXISTS "guardianPortalClassDetailsEnabled" boolean NOT NULL DEFAULT false;
    ALTER TABLE institution_setting
      ADD COLUMN IF NOT EXISTS "guardianPortalAssessmentsEnabled" boolean NOT NULL DEFAULT false;
    ALTER TABLE institution_setting
      ADD COLUMN IF NOT EXISTS "guardianPortalEntranceExamsEnabled" boolean NOT NULL DEFAULT false;
    ALTER TABLE institution_setting
      ADD COLUMN IF NOT EXISTS "guardianPortalAttendanceEnabled" boolean NOT NULL DEFAULT false;
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

export async function ensureHomeworkSchema() {
  const bootstrap = new DataSource({
    ...postgresOptions(),
    synchronize: false,
    entities: [],
  });
  await bootstrap.initialize();
  const [{ usersTable, termsTable, subjectsTable }] = await bootstrap.query(`
    SELECT
      to_regclass('public.users') IS NOT NULL AS "usersTable",
      to_regclass('public.terms') IS NOT NULL AS "termsTable",
      to_regclass('public.subjects') IS NOT NULL AS "subjectsTable"
  `);
  if (!usersTable || !termsTable || !subjectsTable) {
    await bootstrap.destroy();
    return;
  }

  await bootstrap.query(`
    CREATE TABLE IF NOT EXISTS homework (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "title" varchar(160) NOT NULL,
      "description" text,
      "dueDate" date NOT NULL,
      "maxMarks" numeric(5, 2) DEFAULT 100,
      "termId" uuid NOT NULL REFERENCES terms(id) ON DELETE RESTRICT,
      "subjectId" uuid NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
      "yearGroup" varchar(80) NOT NULL,
      "createdById" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE homework ADD COLUMN IF NOT EXISTS "maxMarks" numeric(5, 2) DEFAULT 100;
    CREATE INDEX IF NOT EXISTS "IDX_homework_dueDate" ON homework ("dueDate");
    CREATE INDEX IF NOT EXISTS "IDX_homework_termId" ON homework ("termId");
    CREATE INDEX IF NOT EXISTS "IDX_homework_subjectId" ON homework ("subjectId");
    CREATE INDEX IF NOT EXISTS "IDX_homework_createdById" ON homework ("createdById");

    CREATE TABLE IF NOT EXISTS homework_attachments (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "homeworkId" uuid NOT NULL REFERENCES homework(id) ON DELETE CASCADE,
      "uploadedById" uuid REFERENCES users(id) ON DELETE SET NULL,
      "storageKey" varchar(500) NOT NULL,
      "originalName" varchar(255) NOT NULL,
      "mimeType" varchar(120) NOT NULL,
      "byteSize" integer NOT NULL DEFAULT 0,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS "IDX_homework_attachments_homeworkId"
      ON homework_attachments ("homeworkId");
    CREATE INDEX IF NOT EXISTS "IDX_homework_attachments_uploadedById"
      ON homework_attachments ("uploadedById");

    CREATE TABLE IF NOT EXISTS homework_students (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "homeworkId" uuid NOT NULL REFERENCES homework(id) ON DELETE CASCADE,
      "studentId" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "UQ_homework_students_homeworkId_studentId"
        UNIQUE ("homeworkId", "studentId")
    );
    CREATE INDEX IF NOT EXISTS "IDX_homework_students_homeworkId"
      ON homework_students ("homeworkId");
    CREATE INDEX IF NOT EXISTS "IDX_homework_students_studentId"
      ON homework_students ("studentId");

    CREATE TABLE IF NOT EXISTS homework_submissions (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "homeworkId" uuid NOT NULL REFERENCES homework(id) ON DELETE CASCADE,
      "studentId" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "status" varchar(32) NOT NULL DEFAULT 'DRAFT',
      "submittedAt" timestamptz,
      "marks" numeric(5, 2),
      "maxMarks" numeric(5, 2) DEFAULT 100,
      "feedback" text,
      "isCompleted" boolean NOT NULL DEFAULT false,
      "markedAt" timestamptz,
      "markedById" uuid REFERENCES users(id) ON DELETE SET NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "UQ_homework_submissions_homeworkId_studentId"
        UNIQUE ("homeworkId", "studentId")
    );
    ALTER TABLE homework_submissions ADD COLUMN IF NOT EXISTS "marks" numeric(5, 2);
    ALTER TABLE homework_submissions ADD COLUMN IF NOT EXISTS "maxMarks" numeric(5, 2) DEFAULT 100;
    ALTER TABLE homework_submissions ADD COLUMN IF NOT EXISTS "feedback" text;
    ALTER TABLE homework_submissions ADD COLUMN IF NOT EXISTS "isCompleted" boolean NOT NULL DEFAULT false;
    ALTER TABLE homework_submissions ADD COLUMN IF NOT EXISTS "markedAt" timestamptz;
    ALTER TABLE homework_submissions ADD COLUMN IF NOT EXISTS "markedById" uuid REFERENCES users(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS "IDX_homework_submissions_markedById"
      ON homework_submissions ("markedById");
    CREATE INDEX IF NOT EXISTS "IDX_homework_submissions_homeworkId"
      ON homework_submissions ("homeworkId");
    CREATE INDEX IF NOT EXISTS "IDX_homework_submissions_studentId"
      ON homework_submissions ("studentId");

    CREATE TABLE IF NOT EXISTS homework_submission_files (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "submissionId" uuid NOT NULL REFERENCES homework_submissions(id) ON DELETE CASCADE,
      "storageKey" varchar(500) NOT NULL,
      "originalName" varchar(255) NOT NULL,
      "mimeType" varchar(120) NOT NULL,
      "byteSize" integer NOT NULL DEFAULT 0,
      "sortOrder" integer NOT NULL DEFAULT 0,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS "IDX_homework_submission_files_submissionId"
      ON homework_submission_files ("submissionId");
  `);
  await bootstrap.destroy();
}

/**
 * Idempotent indexes for class timetable / bulk-replace hot paths.
 * Safe when synchronize is off (production); no-ops if indexes already exist.
 */
export async function ensureClassScheduleIndexes() {
  const bootstrap = new DataSource({
    ...postgresOptions(),
    synchronize: false,
    entities: [],
  });
  await bootstrap.initialize();
  try {
    const [{ classesTable, sessionsTable, attendanceTable, scansTable, tasksTable }] =
      await bootstrap.query(`
      SELECT
        to_regclass('public.classes') IS NOT NULL AS "classesTable",
        to_regclass('public.sessions') IS NOT NULL AS "sessionsTable",
        to_regclass('public.attendance_records') IS NOT NULL AS "attendanceTable",
        to_regclass('public.scan_events') IS NOT NULL AS "scansTable",
        to_regclass('public.tasks') IS NOT NULL AS "tasksTable"
    `);
    if (!classesTable || !sessionsTable) {
      return;
    }
    await bootstrap.query(`
      CREATE INDEX IF NOT EXISTS "IDX_classes_classroomId"
        ON classes ("classroomId");
      CREATE INDEX IF NOT EXISTS "IDX_classes_termId"
        ON classes ("termId");
      CREATE INDEX IF NOT EXISTS "IDX_classes_teacherId"
        ON classes ("teacherId");
      CREATE INDEX IF NOT EXISTS "IDX_sessions_classId"
        ON sessions ("classId");
      CREATE INDEX IF NOT EXISTS "IDX_sessions_startAt"
        ON sessions ("startAt");
      CREATE INDEX IF NOT EXISTS "IDX_sessions_classroomId"
        ON sessions ("classroomId");
      CREATE INDEX IF NOT EXISTS "IDX_sessions_teacherId"
        ON sessions ("teacherId");
    `);
    if (attendanceTable) {
      await bootstrap.query(`
        CREATE INDEX IF NOT EXISTS "IDX_attendance_records_sessionId"
          ON attendance_records ("sessionId");
      `);
    }
    if (scansTable) {
      await bootstrap.query(`
        CREATE INDEX IF NOT EXISTS "IDX_scan_events_sessionId"
          ON scan_events ("sessionId");
      `);
    }
    if (tasksTable) {
      await bootstrap.query(`
        CREATE INDEX IF NOT EXISTS "IDX_tasks_sessionId"
          ON tasks ("sessionId");
      `);
    }
  } finally {
    await bootstrap.destroy();
  }
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
    SessionLesson,
    SessionResource,
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
    Homework,
    HomeworkAttachment,
    HomeworkStudent,
    HomeworkSubmission,
    HomeworkSubmissionFile,
    Syllabus,
    SyllabusDocument,
    SyllabusSkill,
  ],
  migrations: [],
  subscribers: [],
});
