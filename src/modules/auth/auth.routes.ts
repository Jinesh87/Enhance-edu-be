import { Router } from "express";
import { authenticate } from "../../common/middleware/authenticate.js";
import { validate } from "../../common/middleware/validate.js";
import { authController } from "./auth.controller.js";
import {
  acceptInvitationSchema,
  invitation2faMethodSchema,
  invitationPasswordSchema,
  invitationPreviewQuerySchema,
  invitationSetupIdSchema,
  invitationVerify2faSchema,
  loginSchema,
} from "./auth.validation.js";

const authRouter = Router();

authRouter.get(
  "/invitation",
  validate(invitationPreviewQuerySchema, "query"),
  authController.getInvitationPreview,
);
authRouter.post(
  "/invitation/password",
  validate(invitationPasswordSchema),
  authController.setupInvitationPassword,
);
authRouter.post(
  "/invitation/2fa-method",
  validate(invitation2faMethodSchema),
  authController.chooseInvitation2faMethod,
);
authRouter.post(
  "/invitation/resend-code",
  validate(invitationSetupIdSchema),
  authController.resendInvitation2faCode,
);
authRouter.post(
  "/invitation/verify-2fa",
  validate(invitationVerify2faSchema),
  authController.verifyInvitation2fa,
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
