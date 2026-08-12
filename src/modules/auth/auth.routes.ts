import { Router } from "express";
import { authenticate } from "../../common/middleware/authenticate.js";
import { validate } from "../../common/middleware/validate.js";
import { authController } from "./auth.controller.js";
import {
  acceptInvitationSchema,
  invitationPreviewQuerySchema,
  loginSchema,
} from "./auth.validation.js";

const authRouter = Router();

authRouter.get(
  "/invitation",
  validate(invitationPreviewQuerySchema, "query"),
  authController.getInvitationPreview,
);
authRouter.post(
  "/accept-invitation",
  validate(acceptInvitationSchema),
  authController.acceptInvitation,
);
authRouter.post("/login", validate(loginSchema), authController.login);
authRouter.post("/refresh", authController.refresh);
authRouter.post("/logout", authController.logout);
authRouter.get("/me", authenticate, authController.me);

export default authRouter;
