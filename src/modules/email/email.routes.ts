import { Router } from "express";
import { emailController } from "./email.controller.js";
import {
  authenticate,
  authorize,
} from "../../common/middleware/authenticate.js";
import { validate } from "../../common/middleware/validate.js";
import { updateMessagingConfigSchema } from "./email.validation.js";
import { UserRole } from "../../common/constants/roles.js";

const router = Router();

// All email config routes require SUPER_ADMIN role
router.use(authenticate, authorize(UserRole.SUPER_ADMIN));

router.get("/config", (req, res) => void emailController.getConfig(req, res));

router.put(
  "/config",
  validate(updateMessagingConfigSchema, "body"),
  (req, res) => void emailController.updateConfig(req, res),
);

export default router;
