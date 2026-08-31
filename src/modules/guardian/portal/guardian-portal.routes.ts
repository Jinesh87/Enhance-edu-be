import { Router } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import {
  authenticate,
  authorize,
} from "../../../common/middleware/authenticate.js";
import { guardianPortalController } from "./guardian-portal.controller.js";

const guardianPortalRouter = Router();

guardianPortalRouter.use(authenticate, authorize(UserRole.GUARDIAN));
guardianPortalRouter.get(
  "/",
  (req, res) => void guardianPortalController.getPortalSettings(req, res),
);

export default guardianPortalRouter;
