import { Router } from "express";
import { teacherClassController } from "./teacher-class.controller.js";
import { authorize } from "../../../common/middleware/authenticate.js";
import { validate } from "../../../common/middleware/validate.js";
import { UserRole } from "../../../common/constants/roles.js";
import {
  teacherSessionIdParamsSchema,
  teacherSessionsPastQuerySchema,
  teacherSessionsUpcomingQuerySchema,
} from "./teacher-class.validation.js";

const router = Router();
const staffOnly = authorize(UserRole.SUPER_ADMIN, UserRole.STAFF);

router.get(
  "/tutor/dashboard",
  staffOnly,
  teacherClassController.getTeacherDashboard,
);

router.get(
  "/tutor/sessions/subjects",
  staffOnly,
  teacherClassController.getTeacherSessionSubjects,
);

router.get(
  "/tutor/sessions/upcoming",
  staffOnly,
  validate(teacherSessionsUpcomingQuerySchema, "query"),
  teacherClassController.listUpcomingSessions,
);

router.get(
  "/tutor/sessions/past",
  staffOnly,
  validate(teacherSessionsPastQuerySchema, "query"),
  teacherClassController.listPastSessions,
);

router.get(
  "/tutor/sessions/:sessionId",
  staffOnly,
  validate(teacherSessionIdParamsSchema, "params"),
  teacherClassController.getSessionDetail,
);

export default router;
