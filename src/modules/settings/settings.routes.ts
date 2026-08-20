import { Router } from "express";
import { settingsController } from "./settings.controller.js";
import {
  authenticate,
  authorize,
  authorizeAdminModule,
} from "../../common/middleware/authenticate.js";
import { validate } from "../../common/middleware/validate.js";
import { updateInstitutionSettingSchema } from "./settings.validation.js";
import { UserRole } from "../../common/constants/roles.js";

const router = Router();

// All settings routes require SUPER_ADMIN role
router.use(
  authenticate,
  authorize(UserRole.SUPER_ADMIN, UserRole.OFFICE_STAFF),
  authorizeAdminModule("settings"),
);

router.get("/institution", (req, res) => void settingsController.getInstitutionSettings(req, res));

router.put(
  "/institution",
  validate(updateInstitutionSettingSchema, "body"),
  (req, res) => void settingsController.updateInstitutionSettings(req, res),
);

export default router;
