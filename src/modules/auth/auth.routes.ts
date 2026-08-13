import { Router } from "express";
import { authenticate } from "../../common/middleware/authenticate.js";
import { validate } from "../../common/middleware/validate.js";
import { authController } from "./auth.controller.js";
import {
  acceptInvitationSchema,
  forgotPasswordSchema,
  invitation2faMethodSchema,
  invitationPasswordSchema,
  invitationPreviewQuerySchema,
  invitationSetupIdSchema,
  invitationVerify2faSchema,
  loginSchema,
  loginChallengeIdSchema,
  loginVerify2faSchema,
  resetPasswordQuerySchema,
  resetPasswordSchema,
} from "./auth.validation.js";

const authRouter = Router();

authRouter.post(
  "/forgot-password",
  validate(forgotPasswordSchema),
  authController.requestPasswordReset,
);
authRouter.get(
  "/reset-password",
  validate(resetPasswordQuerySchema, "query"),
  authController.getPasswordResetPreview,
);
authRouter.post(
  "/reset-password",
  validate(resetPasswordSchema),
  authController.resetPassword,
);
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
authRouter.post(
  "/login/verify-2fa",
  validate(loginVerify2faSchema),
  authController.verifyLogin2fa,
);
authRouter.post(
  "/login/resend-code",
  validate(loginChallengeIdSchema),
  authController.resendLogin2faCode,
);
authRouter.post("/refresh", authController.refresh);
authRouter.post("/logout", authController.logout);
authRouter.get("/me", authenticate, authController.me);

export default authRouter;
