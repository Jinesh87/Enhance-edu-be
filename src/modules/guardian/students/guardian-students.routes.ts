import { Router } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import {
  authenticate,
  authorize,
} from "../../../common/middleware/authenticate.js";
import { guardianStudentsController } from "./guardian-students.controller.js";

const guardianStudentsRouter = Router();

guardianStudentsRouter.use(authenticate, authorize(UserRole.GUARDIAN));
guardianStudentsRouter.get("/", guardianStudentsController.list);

export default guardianStudentsRouter;
