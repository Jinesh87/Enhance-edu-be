import { Router } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import {
  authenticate,
  authorize,
} from "../../../common/middleware/authenticate.js";
import { validate } from "../../../common/middleware/validate.js";
import { adminAuditController } from "./admin-audit.controller.js";
import { listAuditQuerySchema } from "./admin-audit.validation.js";

const adminAuditRouter = Router();

adminAuditRouter.use(authenticate, authorize(UserRole.SUPER_ADMIN));

adminAuditRouter.get(
  "/",
  validate(listAuditQuerySchema, "query"),
  adminAuditController.list,
);
adminAuditRouter.get(
  "/export",
  validate(listAuditQuerySchema, "query"),
  adminAuditController.exportCsv,
);

export default adminAuditRouter;
