import { randomUUID } from "node:crypto";
import { AppDataSource } from "../../config/data-source.js";
import { TwoFactorMethod, UserRole, UserStatus } from "../../common/constants/roles.js";
import { AppError } from "../../common/errors/AppError.js";
import { writeAuditLog } from "../../common/utils/audit-log.js";
import { env } from "../../config/env.js";
import {
  deleteUserPasswordResetTokens,
  generatePasswordResetToken,
  getPasswordResetTokenData,
  storePasswordResetToken,
  verifyAndConsumePasswordResetToken,
} from "../../common/utils/password-reset-redis.js";
import {
  getInvitationTokenData,
  verifyAndConsumeInvitationToken,
} from "../../common/utils/invitation-redis.js";
import {
  deleteInvitationSetup,
  generateSetupId,
  getInvitationSetup,
  storeInvitationSetup,
  updateInvitationSetup,
} from "../../common/utils/invitation-setup.js";
import {
  generateAuthenticatorSecret,
  buildAuthenticatorUri,
  verifyAuthenticatorCode,
} from "../../common/utils/authenticator.js";
import {
  deleteLogin2faChallenge,
  generateLoginChallengeId,
  getLogin2faChallenge,
  issueLogin2faCode,
  storeLogin2faChallenge,
  verifyLogin2faCode,
} from "../../common/utils/login-2fa-redis.js";
import {
  generateSecurityCode,
  storeInvitation2faCode,
  verifyInvitation2faCode,
} from "../../common/utils/two-factor-redis.js";
import { emailService } from "../email/email.service.js";
import { adminEnrollmentsService } from "../admin/enrollments/admin-enrollments.service.js";
import { hashValue, verifyHash } from "../../common/utils/hash.js";
import {
  getRefreshExpiresAt,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../../common/utils/jwt.js";
import { hashPassword, verifyPassword } from "../../common/utils/password.js";
import { RefreshToken, User } from "../../entities/index.js";
import { logger } from "../../config/logger.js";
import type {
  AcceptInvitationInput,
  AuthResult,
  AuthTokens,
  ForgotPasswordInput,
  Invitation2faMethodInput,
  Invitation2faMethodResult,
  InvitationPasswordInput,
  InvitationPasswordResult,
  InvitationPreview,
  InvitationStudentAccountsInput,
  InvitationStudentAccountsResult,
  InvitationVerify2faInput,
  Login2faRequiredResult,
  LoginInput,
  LoginResult,
  PublicUser,
  ResetPasswordInput,
} from "./types/auth.types.js";
import {
  clearLoginLockout,
  getLoginLockStatus,
  recordFailedLoginAttempt,
} from "./utils/login-lockout.js";

function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    fullName: user.fullName,
    preferredName: user.preferredName,
    email: user.email,
    username: user.username,
    mobile: user.mobile,
    role: user.role,
    status: user.status,
    securitySetupComplete: user.securitySetupComplete,
    lastSignedInAt: user.lastSignedInAt,
  };
}

export class AuthService {
  private readonly users = AppDataSource.getRepository(User);
  private readonly refreshTokens = AppDataSource.getRepository(RefreshToken);

  async getInvitationPreview(token: string): Promise<InvitationPreview> {
    const invitationData = await getInvitationTokenData(token);

    if (!invitationData) {
      throw new AppError(
        400,
        "Invitation link is invalid or has expired",
        "INVALID_INVITATION",
      );
    }

    const user = await this.users.findOne({
      where: { id: invitationData.userId },
    });

    if (!user || user.status !== UserStatus.INVITED) {
      throw new AppError(
        400,
        "Invitation link is invalid or has expired",
        "INVALID_INVITATION",
      );
    }

    const config = await emailService.getConfig();
    const pendingStudents =
      user.role === UserRole.GUARDIAN
        ? await adminEnrollmentsService.listPendingStudentsForGuardian(user.id)
        : [];

    return {
      email: user.email!,
      fullName: user.fullName,
      role: user.role,
      email2faAvailable: Boolean(config?.enabled && config?.resendApiKey),
      sms2faAvailable: Boolean(
        config?.smsEnabled &&
          config?.twilioAccountSid &&
          config?.twilioAuthToken &&
          config?.twilioFromNumber,
      ),
      authenticator2faAvailable: true,
      pendingStudents,
    };
  }

  async setupInvitationPassword(
    input: InvitationPasswordInput,
  ): Promise<InvitationPasswordResult> {
    const invitationData = await getInvitationTokenData(input.token);

    if (!invitationData) {
      throw new AppError(
        400,
        "Invitation link is invalid or has expired",
        "INVALID_INVITATION",
      );
    }

    const email = input.email.toLowerCase();
    if (email !== invitationData.email.toLowerCase()) {
      throw new AppError(
        400,
        "Email does not match the invitation",
        "EMAIL_MISMATCH",
      );
    }

    const user = await this.users.findOne({
      where: { id: invitationData.userId },
    });

    if (!user || user.status !== UserStatus.INVITED) {
      throw new AppError(
        400,
        "Invitation link is invalid or has expired",
        "INVALID_INVITATION",
      );
    }

    const setupId = generateSetupId();
    const pendingStudents =
      user.role === UserRole.GUARDIAN
        ? await adminEnrollmentsService.listPendingStudentsForGuardian(user.id)
        : [];

    await storeInvitationSetup(setupId, {
      invitationToken: input.token,
      userId: user.id,
      email: user.email!,
      fullName: user.fullName,
      role: user.role,
      passwordHash: await hashPassword(input.password),
      preferredName: input.preferredName?.trim() || null,
      mobile: user.mobile,
    });

    logger.info({ userId: user.id, setupId }, "Invitation password step completed");

    return {
      setupId,
      email: user.email!,
      fullName: user.fullName,
      role: user.role,
      pendingStudents,
    };
  }

  async setupInvitationStudentAccounts(
    input: InvitationStudentAccountsInput,
  ): Promise<InvitationStudentAccountsResult> {
    const setup = await getInvitationSetup(input.setupId);

    if (!setup) {
      throw new AppError(
        400,
        "Setup session has expired. Please start again from your invitation link.",
        "SETUP_EXPIRED",
      );
    }

    if (setup.role !== UserRole.GUARDIAN) {
      throw new AppError(
        400,
        "Student login setup is only for guardian invitations",
        "NOT_A_GUARDIAN",
      );
    }

    const pendingStudents =
      await adminEnrollmentsService.listPendingStudentsForGuardian(setup.userId);

    if (pendingStudents.length === 0) {
      throw new AppError(
        400,
        "There are no students to configure",
        "NO_PENDING_STUDENTS",
      );
    }

    if (input.students.length !== pendingStudents.length) {
      throw new AppError(
        400,
        "Set up login details for every student",
        "STUDENT_ACCOUNTS_INCOMPLETE",
      );
    }

    const usernames = new Set<string>();
    const studentAccounts: NonNullable<
      typeof setup.studentAccounts
    > = [];

    for (const row of input.students) {
      if (
        !pendingStudents.some(
          (pending) => pending.pendingEnrollmentId === row.pendingEnrollmentId,
        )
      ) {
        throw new AppError(
          400,
          "One or more student records are invalid",
          "INVALID_PENDING_STUDENT",
        );
      }

      const username = row.username.trim().toLowerCase();
      if (usernames.has(username)) {
        throw new AppError(
          400,
          "Each student needs a unique username",
          "DUPLICATE_USERNAME",
        );
      }
      usernames.add(username);

      const existing = await this.users.findOne({ where: { username } });
      if (existing) {
        throw new AppError(
          409,
          `Username "${row.username}" is already taken`,
          "USERNAME_IN_USE",
        );
      }

      studentAccounts.push({
        pendingEnrollmentId: row.pendingEnrollmentId,
        username,
        passwordHash: await hashPassword(row.password),
      });
    }

    setup.studentAccounts = studentAccounts;
    const updated = await updateInvitationSetup(input.setupId, setup);
    if (!updated) {
      throw new AppError(
        400,
        "Setup session has expired. Please start again from your invitation link.",
        "SETUP_EXPIRED",
      );
    }

    return {
      setupId: input.setupId,
      configuredCount: studentAccounts.length,
    };
  }

  async chooseInvitation2faMethod(
    input: Invitation2faMethodInput,
  ): Promise<Invitation2faMethodResult> {
    const setup = await getInvitationSetup(input.setupId);

    if (!setup) {
      throw new AppError(
        400,
        "Setup session has expired. Please start again from your invitation link.",
        "SETUP_EXPIRED",
      );
    }

    if (setup.role === UserRole.GUARDIAN) {
      const pendingStudents =
        await adminEnrollmentsService.listPendingStudentsForGuardian(setup.userId);
      if (
        pendingStudents.length > 0 &&
        setup.studentAccounts?.length !== pendingStudents.length
      ) {
        throw new AppError(
          400,
          "Set up student login details before continuing",
          "STUDENT_ACCOUNTS_REQUIRED",
        );
      }
    }

    if (
      input.method !== TwoFactorMethod.EMAIL &&
      input.method !== TwoFactorMethod.SMS &&
      input.method !== TwoFactorMethod.AUTHENTICATOR
    ) {
      throw new AppError(400, "Invalid verification method", "INVALID_METHOD");
    }

    setup.twoFactorMethod = input.method;

    if (input.method === TwoFactorMethod.AUTHENTICATOR) {
      const secret = generateAuthenticatorSecret();
      setup.authenticatorSecret = secret;
      const saved = await updateInvitationSetup(input.setupId, setup);
      if (!saved) {
        throw new AppError(
          400,
          "Setup session has expired. Please start again from your invitation link.",
          "SETUP_EXPIRED",
        );
      }

      logger.info(
        { userId: setup.userId, setupId: input.setupId },
        "Authenticator enrollment started for invitation setup",
      );

      return {
        setupId: input.setupId,
        method: input.method,
        codeSent: false,
        otpauthUrl: buildAuthenticatorUri(setup.email, secret),
        authenticatorSecret: secret,
      };
    }

    if (input.method === TwoFactorMethod.SMS) {
      const mobile = input.mobile?.trim() || setup.mobile;
      if (!mobile) {
        throw new AppError(
          400,
          "Mobile number is required for text message verification",
          "MOBILE_REQUIRED",
        );
      }
      setup.mobile = mobile;
    }

    setup.authenticatorSecret = undefined;
    const saved = await updateInvitationSetup(input.setupId, setup);
    if (!saved) {
      throw new AppError(
        400,
        "Setup session has expired. Please start again from your invitation link.",
        "SETUP_EXPIRED",
      );
    }

    const code = generateSecurityCode();
    await storeInvitation2faCode(input.setupId, code);

    if (input.method === TwoFactorMethod.EMAIL) {
      await emailService.sendSecurityCodeEmail({
        to: setup.email,
        fullName: setup.fullName,
        code,
      });
    } else {
      await emailService.sendSecurityCodeSms({
        to: setup.mobile!,
        fullName: setup.fullName,
        code,
      });
    }

    logger.info(
      { userId: setup.userId, setupId: input.setupId },
      "2FA code sent for invitation setup",
    );

    return {
      setupId: input.setupId,
      method: input.method,
      codeSent: true,
    };
  }

  async resendInvitation2faCode(setupId: string): Promise<void> {
    const setup = await getInvitationSetup(setupId);

    if (!setup) {
      throw new AppError(
        400,
        "Setup session has expired. Please start again from your invitation link.",
        "SETUP_EXPIRED",
      );
    }

    if (setup.twoFactorMethod === TwoFactorMethod.AUTHENTICATOR) {
      throw new AppError(
        400,
        "Authenticator codes come from your app. Scan the QR code and enter the current code.",
        "NO_RESEND",
      );
    }

    if (
      setup.twoFactorMethod !== TwoFactorMethod.EMAIL &&
      setup.twoFactorMethod !== TwoFactorMethod.SMS
    ) {
      throw new AppError(
        400,
        "No verification in progress",
        "NO_VERIFICATION",
      );
    }

    const code = generateSecurityCode();
    await storeInvitation2faCode(setupId, code);

    if (setup.twoFactorMethod === TwoFactorMethod.EMAIL) {
      await emailService.sendSecurityCodeEmail({
        to: setup.email,
        fullName: setup.fullName,
        code,
      });
    } else {
      await emailService.sendSecurityCodeSms({
        to: setup.mobile!,
        fullName: setup.fullName,
        code,
      });
    }

    logger.info({ userId: setup.userId, setupId }, "2FA code resent");
  }

  async verifyInvitation2faAndActivate(
    input: InvitationVerify2faInput,
  ): Promise<AuthResult> {
    const setup = await getInvitationSetup(input.setupId);

    if (!setup) {
      throw new AppError(
        400,
        "Setup session has expired. Please start again from your invitation link.",
        "SETUP_EXPIRED",
      );
    }

    if (!setup.twoFactorMethod) {
      throw new AppError(
        400,
        "Choose a verification method first",
        "METHOD_NOT_CHOSEN",
      );
    }

    if (setup.twoFactorMethod === TwoFactorMethod.AUTHENTICATOR) {
      if (!setup.authenticatorSecret) {
        throw new AppError(
          400,
          "Authenticator setup is incomplete. Choose the method again.",
          "SETUP_INCOMPLETE",
        );
      }
      if (!verifyAuthenticatorCode(input.code, setup.authenticatorSecret)) {
        throw new AppError(400, "Wrong code. Try again.", "INVALID_CODE");
      }
    } else {
      const codeValid = await verifyInvitation2faCode(input.setupId, input.code);
      if (!codeValid) {
        throw new AppError(400, "Wrong code. Try again.", "INVALID_CODE");
      }
    }

    // Consume the one-time invitation token
    try {
      await verifyAndConsumeInvitationToken(setup.invitationToken);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        400,
        "Invitation link is invalid or has expired",
        "INVALID_INVITATION",
      );
    }

    const user = await this.users.findOne({ where: { id: setup.userId } });

    if (!user) {
      throw new AppError(404, "User not found", "USER_NOT_FOUND");
    }

    if (user.status !== UserStatus.INVITED) {
      throw new AppError(
        400,
        "This invitation has already been accepted",
        "ALREADY_ACCEPTED",
      );
    }

    user.preferredName = setup.preferredName;
    user.mobile = setup.mobile;
    user.passwordHash = setup.passwordHash;
    user.twoFactorMethod = setup.twoFactorMethod;
    user.authenticatorSecret =
      setup.twoFactorMethod === TwoFactorMethod.AUTHENTICATOR
        ? setup.authenticatorSecret ?? null
        : null;
    user.status = UserStatus.ACTIVE;
    user.securitySetupComplete = true;
    user.invitationTokenHash = null;
    user.invitationExpiresAt = null;
    user.lastSignedInAt = new Date();

    await this.users.save(user);

    if (user.role === UserRole.GUARDIAN) {
      await adminEnrollmentsService.fulfillPendingEnrollmentsForGuardian(
        user.id,
        setup.studentAccounts ?? [],
      );
    }

    if (
      setup.twoFactorMethod === TwoFactorMethod.AUTHENTICATOR &&
      setup.authenticatorSecret
    ) {
      await this.users.update(user.id, {
        authenticatorSecret: setup.authenticatorSecret,
        twoFactorMethod: TwoFactorMethod.AUTHENTICATOR,
      });
    }
    await deleteInvitationSetup(input.setupId);

    logger.info(
      { userId: user.id, email: user.email, method: setup.twoFactorMethod },
      "User accepted invitation with 2FA and account activated",
    );

    const tokens = await this.issueTokens(user);
    return { user: toPublicUser(user), tokens };
  }

  /** @deprecated Use multi-step invitation flow instead */
  async acceptInvitation(input: AcceptInvitationInput): Promise<AuthResult> {
    // Verify and consume the one-time invitation token from Redis
    let invitationData;
    try {
      invitationData = await verifyAndConsumeInvitationToken(input.token);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        400,
        "Invitation link is invalid or has expired",
        "INVALID_INVITATION",
      );
    }

    // Verify the email matches
    const email = input.email.toLowerCase();
    if (email !== invitationData.email.toLowerCase()) {
      throw new AppError(
        400,
        "Email does not match the invitation",
        "EMAIL_MISMATCH",
      );
    }

    // Get user from database
    const user = await this.users.findOne({ where: { id: invitationData.userId } });

    if (!user) {
      throw new AppError(404, "User not found", "USER_NOT_FOUND");
    }

    if (user.status !== UserStatus.INVITED) {
      throw new AppError(
        400,
        "This invitation has already been accepted",
        "ALREADY_ACCEPTED",
      );
    }

    // Set preferred name if provided
    if (input.preferredName !== undefined) {
      user.preferredName = input.preferredName?.trim() || null;
    }

    // Set password and activate account
    user.passwordHash = await hashPassword(input.password);
    user.status = UserStatus.ACTIVE;
    user.securitySetupComplete = true;
    user.invitationTokenHash = null;
    user.invitationExpiresAt = null;
    user.lastSignedInAt = new Date();

    await this.users.save(user);

    if (user.role === UserRole.GUARDIAN) {
      const pendingStudents =
        await adminEnrollmentsService.listPendingStudentsForGuardian(user.id);
      if (pendingStudents.length > 0) {
        throw new AppError(
          400,
          "Use the full invitation flow to configure student login details",
          "STUDENT_ACCOUNTS_REQUIRED",
        );
      }
    }

    logger.info(
      { userId: user.id, email: user.email },
      "User accepted invitation and account activated",
    );

    const tokens = await this.issueTokens(user);
    return { user: toPublicUser(user), tokens };
  }

  async requestPasswordReset(input: ForgotPasswordInput): Promise<void> {
    const email = input.email.toLowerCase().trim();
    const user = await this.users.findOne({ where: { email } });

    // Always return quietly — never reveal whether the address exists.
    if (!user || user.status !== UserStatus.ACTIVE || !user.passwordHash || !user.email) {
      logger.info(
        { email },
        "Password reset requested for unknown or inactive account",
      );
      return;
    }

    await deleteUserPasswordResetTokens(user.id);

    const token = generatePasswordResetToken();
    await storePasswordResetToken(token, {
      userId: user.id,
      email: user.email!,
    });

    const frontendUrl = (
      env.FRONTEND_URL
    ).replace(/\/$/, "");
    const resetLink = `${frontendUrl}/reset-password?token=${encodeURIComponent(token)}`;

    try {
      await emailService.sendPasswordResetEmail({
        to: user.email!,
        fullName: user.preferredName || user.fullName,
        resetLink,
      });
    } catch (error) {
      logger.error(
        { error, userId: user.id, email: user.email },
        "Failed to send password reset email",
      );
      if (env.NODE_ENV !== "production") {
        logger.info({ resetLink }, "Password reset link (dev fallback)");
      }
    }
  }

  async getPasswordResetPreview(token: string): Promise<{ email: string }> {
    const data = await getPasswordResetTokenData(token);

    if (!data) {
      throw new AppError(
        400,
        "This reset link is invalid or has expired",
        "INVALID_RESET_TOKEN",
      );
    }

    const user = await this.users.findOne({ where: { id: data.userId } });

    if (!user || user.status !== UserStatus.ACTIVE || !user.email) {
      throw new AppError(
        400,
        "This reset link is invalid or has expired",
        "INVALID_RESET_TOKEN",
      );
    }

    return { email: user.email };
  }

  async resetPassword(input: ResetPasswordInput): Promise<AuthResult> {
    const resetData = await verifyAndConsumePasswordResetToken(input.token);
    const user = await this.users.findOne({ where: { id: resetData.userId } });

    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new AppError(
        400,
        "This reset link is invalid or has expired",
        "INVALID_RESET_TOKEN",
      );
    }

    user.passwordHash = await hashPassword(input.password);
    user.lastSignedInAt = new Date();
    await this.users.save(user);

    await clearLoginLockout(
      (user.email ?? user.username ?? user.id).toLowerCase(),
    );

    logger.info({ userId: user.id }, "User reset password and signed in");

    const tokens = await this.issueTokens(user);
    return { user: toPublicUser(user), tokens };
  }

  async login(input: LoginInput): Promise<LoginResult> {
    const identifier = input.identifier.trim();
    const lockKey = identifier.toLowerCase();

    const lock = await getLoginLockStatus(lockKey);
    if (lock.locked) {
      throw new AppError(
        429,
        "Too many attempts. Sign-in is paused for 15 minutes",
        "LOCKED",
        { lockedUntil: lock.lockedUntil },
      );
    }

    const user = identifier.includes("@")
      ? await this.users.findOne({ where: { email: identifier.toLowerCase() } })
      : await this.users.findOne({
          where: { username: identifier.toLowerCase() },
        });

    if (!user || !user.passwordHash) {
      await recordFailedLoginAttempt(lockKey);
      await writeAuditLog({
        actorName: identifier,
        action: "DENIED",
        recordType: "account",
        recordLabel: identifier,
        after: { reason: "INVALID_CREDENTIALS" },
      });
      throw new AppError(
        401,
        "Invalid username or password",
        "INVALID_CREDENTIALS",
      );
    }

    if (user.status === UserStatus.DEACTIVATED) {
      throw new AppError(403, "This account has been deactivated", "DEACTIVATED");
    }

    if (user.status === UserStatus.INVITED) {
      throw new AppError(
        403,
        "Invitation has not been accepted yet",
        "INVITATION_PENDING",
      );
    }

    const valid = await verifyPassword(input.password, user.passwordHash);

    if (!valid) {
      const afterFail = await recordFailedLoginAttempt(lockKey);

      await writeAuditLog({
        actorUserId: user.id,
        actorName: user.fullName,
        action: "DENIED",
        recordType: "account",
        recordId: user.id,
        recordLabel: user.email ?? identifier,
        after: { reason: "INVALID_CREDENTIALS" },
      });

      if (afterFail.locked) {
        throw new AppError(
          429,
          "Too many attempts. Sign-in is paused for 15 minutes",
          "LOCKED",
          { lockedUntil: afterFail.lockedUntil },
        );
      }

      throw new AppError(
        401,
        "Invalid username or password",
        "INVALID_CREDENTIALS",
      );
    }

    await clearLoginLockout(lockKey);

    // 2FA is disabled for login for now.
    // if (user.securitySetupComplete && user.twoFactorMethod) {
    //   return this.startLogin2faChallenge(user);
    // }

    user.lastSignedInAt = new Date();
    await this.users.save(user);

    const tokens = await this.issueTokens(user);
    return { user: toPublicUser(user), tokens };
  }

  async verifyLogin2fa(input: {
    challengeId: string;
    code: string;
  }): Promise<AuthResult> {
    const challenge = await getLogin2faChallenge(input.challengeId);
    if (!challenge) {
      throw new AppError(
        400,
        "This sign-in code has expired. Sign in again.",
        "CHALLENGE_EXPIRED",
      );
    }

    const user = await this.users.findOne({ where: { id: challenge.userId } });
    if (!user || user.status !== UserStatus.ACTIVE) {
      await deleteLogin2faChallenge(input.challengeId);
      throw new AppError(403, "Account is not active", "INACTIVE");
    }

    let codeValid = false;
    if (challenge.method === TwoFactorMethod.AUTHENTICATOR) {
      if (!user.authenticatorSecret) {
        throw new AppError(
          400,
          "Authenticator is not set up for this account",
          "SETUP_INCOMPLETE",
        );
      }
      codeValid = verifyAuthenticatorCode(input.code, user.authenticatorSecret);
    } else {
      codeValid = await verifyLogin2faCode(input.challengeId, input.code);
    }

    if (!codeValid) {
      throw new AppError(400, "Wrong code. Try again.", "INVALID_CODE");
    }

    await deleteLogin2faChallenge(input.challengeId);
    user.lastSignedInAt = new Date();
    await this.users.save(user);

    const tokens = await this.issueTokens(user);
    return { user: toPublicUser(user), tokens };
  }

  async resendLogin2faCode(challengeId: string): Promise<void> {
    const challenge = await getLogin2faChallenge(challengeId);
    if (!challenge) {
      throw new AppError(
        400,
        "This sign-in code has expired. Sign in again.",
        "CHALLENGE_EXPIRED",
      );
    }

    if (challenge.method === TwoFactorMethod.AUTHENTICATOR) {
      throw new AppError(
        400,
        "Authenticator codes come from your app. Enter the current code.",
        "NO_RESEND",
      );
    }

    const user = await this.users.findOne({ where: { id: challenge.userId } });
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new AppError(403, "Account is not active", "INACTIVE");
    }

    const code = await issueLogin2faCode(challengeId);
    if (challenge.method === TwoFactorMethod.EMAIL) {
      if (!user.email) {
        throw new AppError(
          400,
          "No email address is on this account",
          "EMAIL_REQUIRED",
        );
      }
      await emailService.sendSecurityCodeEmail({
        to: user.email,
        fullName: user.preferredName || user.fullName,
        code,
      });
    } else if (challenge.method === TwoFactorMethod.SMS) {
      if (!user.mobile) {
        throw new AppError(
          400,
          "No mobile number is on this account",
          "MOBILE_REQUIRED",
        );
      }
      await emailService.sendSecurityCodeSms({
        to: user.mobile,
        fullName: user.preferredName || user.fullName,
        code,
      });
    }
  }

  private async startLogin2faChallenge(
    user: User,
  ): Promise<Login2faRequiredResult> {
    let method = user.twoFactorMethod!;
    if (method === TwoFactorMethod.AUTHENTICATOR && !user.authenticatorSecret) {
      logger.warn(
        { userId: user.id },
        "Authenticator is selected but no secret is stored; using email code instead",
      );
      method = TwoFactorMethod.EMAIL;
    }

    const challengeId = generateLoginChallengeId();
    await storeLogin2faChallenge(challengeId, {
      userId: user.id,
      email: user.email ?? user.username ?? user.id,
      method,
    });

    let codeSent = false;
    if (method === TwoFactorMethod.EMAIL || method === TwoFactorMethod.SMS) {
      const code = await issueLogin2faCode(challengeId);
      if (method === TwoFactorMethod.EMAIL) {
        if (!user.email) {
          throw new AppError(
            400,
            "No email address is on this account",
            "EMAIL_REQUIRED",
          );
        }
        await emailService.sendSecurityCodeEmail({
          to: user.email,
          fullName: user.preferredName || user.fullName,
          code,
        });
      } else {
        if (!user.mobile) {
          throw new AppError(
            400,
            "No mobile number is on this account",
            "MOBILE_REQUIRED",
          );
        }
        await emailService.sendSecurityCodeSms({
          to: user.mobile,
          fullName: user.preferredName || user.fullName,
          code,
        });
      }
      codeSent = true;
    }

    logger.info(
      { userId: user.id, method },
      "Login 2FA challenge started",
    );

    return {
      requires2fa: true,
      challengeId,
      method,
      codeSent,
    };
  }

  async refresh(rawRefreshToken: string): Promise<AuthResult> {
    let payload;

    try {
      payload = verifyRefreshToken(rawRefreshToken);
    } catch {
      throw new AppError(401, "Invalid or expired refresh token", "INVALID_TOKEN");
    }

    const stored = await this.refreshTokens.findOne({
      where: { id: payload.tokenId },
    });

    if (
      !stored ||
      stored.revokedAt ||
      stored.expiresAt < new Date() ||
      !(await verifyHash(rawRefreshToken, stored.tokenHash))
    ) {
      throw new AppError(401, "Invalid or expired refresh token", "INVALID_TOKEN");
    }

    const user = await this.users.findOne({ where: { id: stored.userId } });
    if (!user) {
      throw new AppError(401, "Invalid or expired refresh token", "INVALID_TOKEN");
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new AppError(403, "Account is not active", "INACTIVE");
    }

    stored.revokedAt = new Date();
    await this.refreshTokens.save(stored);

    const tokens = await this.issueTokens(user);
    return { user: toPublicUser(user), tokens };
  }

  async logout(rawRefreshToken?: string): Promise<void> {
    if (!rawRefreshToken) {
      return;
    }

    try {
      const payload = verifyRefreshToken(rawRefreshToken);
      const stored = await this.refreshTokens.findOne({
        where: { id: payload.tokenId },
      });

      if (stored && !stored.revokedAt) {
        stored.revokedAt = new Date();
        await this.refreshTokens.save(stored);
      }
    } catch {
      // Ignore invalid refresh tokens on logout
    }
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.users.findOne({ where: { id: userId } });

    if (!user) {
      throw new AppError(404, "User not found", "NOT_FOUND");
    }

    return toPublicUser(user);
  }

  private async issueTokens(user: User): Promise<AuthTokens> {
    const tokenId = randomUUID();
    const refreshToken = signRefreshToken({ sub: user.id, tokenId });
    const accessToken = signAccessToken({
      sub: user.id,
      email: user.email ?? user.username ?? user.id,
      role: user.role,
    });

    const record = this.refreshTokens.create({
      id: tokenId,
      tokenHash: await hashValue(refreshToken),
      userId: user.id,
      expiresAt: getRefreshExpiresAt(),
      revokedAt: null,
    });

    await this.refreshTokens.save(record);

    return { accessToken, refreshToken };
  }
}

export const authService = new AuthService();
