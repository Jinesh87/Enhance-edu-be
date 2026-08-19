import "reflect-metadata";
import { DataSource } from "typeorm";
import {
  RefreshToken,
  User,
  Class,
  Session,
  ClassStudent,
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
  AuditChange,
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
  await bootstrap.destroy();
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
    AuditChange,
  ],
  migrations: [],
  subscribers: [],
});
