import { Router } from "express";
import { teacherClassController } from "./teacher-class.controller.js";
import { authorize } from "../../../common/middleware/authenticate.js";
import { UserRole } from "../../../common/constants/roles.js";

const router = Router();
const staffOnly = authorize(UserRole.SUPER_ADMIN, UserRole.STAFF);

router.get(
  "/tutor/dashboard",
  staffOnly,
  teacherClassController.getTeacherDashboard,
);

export default router;
