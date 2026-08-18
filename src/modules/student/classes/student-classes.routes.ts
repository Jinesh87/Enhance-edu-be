import { Router } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import {
  authenticate,
  authorize,
} from "../../../common/middleware/authenticate.js";
import { studentClassesController } from "./student-classes.controller.js";

const router = Router();

router.use(authenticate, authorize(UserRole.STUDENT));

router.get("/timetable", studentClassesController.getTimetable);
router.get("/lessons/:sessionId", studentClassesController.getLesson);

export default router;
