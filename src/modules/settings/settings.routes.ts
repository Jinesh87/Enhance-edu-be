import { Router } from "express";
import { settingsController } from "./settings.controller.js";
import { holidaysController } from "./holidays.controller.js";
import {
  authenticate,
  authorize,
  authorizeAdminModule,
} from "../../common/middleware/authenticate.js";
import { validate } from "../../common/middleware/validate.js";
import {
  updateInstitutionSettingSchema,
  updateSecuritySettingSchema,
} from "./settings.validation.js";
import {
  createHolidaySchema,
  holidayIdParamsSchema,
  listHolidaysQuerySchema,
  updateHolidaySchema,
} from "./holidays.validation.js";
import { UserRole } from "../../common/constants/roles.js";

const router = Router();

router.use(
  authenticate,
  authorize(UserRole.SUPER_ADMIN, UserRole.OFFICE_STAFF),
);

// Readable by settings and classes (timetable generation skips holiday dates).
router.get(
  "/holidays",
  authorizeAdminModule("settings", "classes"),
  validate(listHolidaysQuerySchema, "query"),
  holidaysController.list,
);

router.use(authorizeAdminModule("settings"));

router.get("/institution", (req, res) => void settingsController.getInstitutionSettings(req, res));

router.put(
  "/institution",
  validate(updateInstitutionSettingSchema, "body"),
  (req, res) => void settingsController.updateInstitutionSettings(req, res),
);

// Login 2FA toggle — Super Admin only
router.get(
  "/security",
  authorize(UserRole.SUPER_ADMIN),
  (req, res) => void settingsController.getSecuritySettings(req, res),
);

router.put(
  "/security",
  authorize(UserRole.SUPER_ADMIN),
  validate(updateSecuritySettingSchema, "body"),
  (req, res) => void settingsController.updateSecuritySettings(req, res),
);

router.post(
  "/holidays",
  validate(createHolidaySchema),
  holidaysController.create,
);
router.patch(
  "/holidays/:id",
  validate(holidayIdParamsSchema, "params"),
  validate(updateHolidaySchema),
  holidaysController.update,
);
router.delete(
  "/holidays/:id",
  validate(holidayIdParamsSchema, "params"),
  holidaysController.remove,
);

export default router;
