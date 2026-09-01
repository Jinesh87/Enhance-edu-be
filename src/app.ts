import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { errorHandler } from "./common/middleware/error-handler.js";
import { logger } from "./config/logger.js";
import { env } from "./config/env.js";
import authRouter from "./modules/auth/auth.routes.js";
import healthRouter from "./modules/health/health.routes.js";
import usersRouter from "./modules/users/users.routes.js";
import emailRouter from "./modules/email/email.routes.js";
import settingsRouter from "./modules/settings/settings.routes.js";
import studentAttendanceRouter from "./modules/student/attendance/student-attendance.routes.js";
import teacherAttendanceRouter from "./modules/teacher/attendance/teacher-attendance.routes.js";
import teacherClassRouter from "./modules/teacher/class/teacher-class.routes.js";
import teacherAssessmentResourcesRouter from "./modules/teacher/assessments/teacher-assessment-resources.routes.js";
import teacherHomeworkRouter from "./modules/teacher/homework/teacher-homework.routes.js";
import adminAttendanceRouter from "./modules/admin/attendance/admin-attendance.routes.js";
import adminTasksRouter from "./modules/admin/tasks/admin-tasks.routes.js";
import adminSubjectsRouter from "./modules/admin/subjects/admin-subjects.routes.js";
import adminSyllabusRouter from "./modules/admin/syllabus/admin-syllabus.routes.js";
import adminYearLevelsRouter from "./modules/admin/year-levels/admin-year-levels.routes.js";
import adminTermsRouter from "./modules/admin/terms/admin-terms.routes.js";
import adminEnrollmentsRouter from "./modules/admin/enrollments/admin-enrollments.routes.js";
import adminClassesRouter from "./modules/admin/classes/admin-classes.routes.js";
import adminAssessmentsRouter from "./modules/admin/assessments/admin-assessments.routes.js";
import teacherAssessmentsRouter from "./modules/teacher/assessments/teacher-assessments.routes.js";
import adminAuditRouter from "./modules/admin/audit/admin-audit.routes.js";
import adminEnquiriesRouter from "./modules/admin/enquiries/admin-enquiries.routes.js";
import guardianStudentsRouter from "./modules/guardian/students/guardian-students.routes.js";
import guardianPortalRouter from "./modules/guardian/portal/guardian-portal.routes.js";
import studentClassesRouter from "./modules/student/classes/student-classes.routes.js";
import studentEntranceExamsRouter from "./modules/student/entrance-exams/student-entrance-exams.routes.js";
import { authenticate } from "./common/middleware/authenticate.js";

const app = express();

app.use(
  cors({
    origin: env.CORS_ORIGIN?.split(",").map((value) => value.trim()) ?? true,
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());

app.use((req, res, next) => {
  const started = Date.now();
  res.on("finish", () => {
    logger.info(
      {
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: Date.now() - started,
      },
      "request",
    );
  });
  next();
});

app.use("/api/health", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/email", emailRouter);
app.use("/api/settings", settingsRouter);
const attendanceRouter = express.Router();
attendanceRouter.use(authenticate);
attendanceRouter.use(studentAttendanceRouter);
attendanceRouter.use(teacherAttendanceRouter);
attendanceRouter.use(teacherClassRouter);
attendanceRouter.use(teacherAssessmentResourcesRouter);
attendanceRouter.use(teacherHomeworkRouter);
attendanceRouter.use(adminAttendanceRouter);

app.use("/api/attendance", attendanceRouter);
app.use("/api/tasks", adminTasksRouter);
app.use("/api/subjects", adminSubjectsRouter);
app.use("/api/syllabus", adminSyllabusRouter);
app.use("/api/year-levels", adminYearLevelsRouter);
app.use("/api/terms", adminTermsRouter);
app.use("/api/enquiries", adminEnquiriesRouter);
app.use("/api/enrollments", adminEnrollmentsRouter);
app.use("/api/classes", adminClassesRouter);
app.use("/api/assessments", adminAssessmentsRouter);
app.use("/api/teacher/assessments", teacherAssessmentsRouter);
app.use("/api/audit-logs", adminAuditRouter);
app.use("/api/student", studentClassesRouter);
app.use("/api/student/entrance-exams", studentEntranceExamsRouter);
app.use("/api/guardian/students", guardianStudentsRouter);
app.use("/api/guardian/portal-settings", guardianPortalRouter);

app.use(errorHandler);

export default app;
