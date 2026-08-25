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
