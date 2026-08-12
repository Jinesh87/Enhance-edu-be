import { randomUUID } from "node:crypto";
import { AppDataSource } from "../../config/data-source.js";
import { UserStatus } from "../../common/constants/roles.js";
import { AppError } from "../../common/errors/AppError.js";
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
  generateSecurityCode,
  storeInvitation2faCode,
  verifyInvitation2faCode,
} from "../../common/utils/two-factor-redis.js";
import { emailService } from "../email/email.service.js";
import { TwoFactorMethod } from "../../common/constants/roles.js";
import { hashValue, verifyHash } from "../../common/utils/hash.js";
import {
  getRefreshExpiresAt,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../../common/utils/jwt.js";
import { hashPassword, verifyPassword } from "../../common/utils/password.js";
import { RefreshToken } from "../../entities/RefreshToken.js";
import { User } from "../../entities/User.js";
import { logger } from "../../config/logger.js";
import type {
  AcceptInvitationInput,
  AuthResult,
  AuthTokens,
  Invitation2faMethodInput,
  Invitation2faMethodResult,
  InvitationPasswordInput,
  InvitationPasswordResult,
  InvitationPreview,
  InvitationVerify2faInput,
  LoginInput,
  PublicUser,
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

    return {
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      email2faAvailable: Boolean(config?.enabled && config?.resendApiKey),
      sms2faAvailable: Boolean(
        config?.smsEnabled &&
          config?.twilioAccountSid &&
          config?.twilioAuthToken &&
          config?.twilioFromNumber,
      ),
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
    await storeInvitationSetup(setupId, {
      invitationToken: input.token,
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      passwordHash: await hashPassword(input.password),
      preferredName: input.preferredName?.trim() || null,
      mobile: user.mobile,
    });

    logger.info({ userId: user.id, setupId }, "Invitation password step completed");

    return {
      setupId,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
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

    if (input.method === TwoFactorMethod.AUTHENTICATOR) {
      throw new AppError(
        501,
        "This verification method is not available yet",
        "METHOD_NOT_AVAILABLE",
      );
    }

    if (
      input.method !== TwoFactorMethod.EMAIL &&
      input.method !== TwoFactorMethod.SMS
    ) {
      throw new AppError(400, "Invalid verification method", "INVALID_METHOD");
    }

    setup.twoFactorMethod = input.method;
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
    await updateInvitationSetup(input.setupId, setup);

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

    logger.info({ userId: setup.userId, setupId }, "2FA email code resent");
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

    const codeValid = await verifyInvitation2faCode(input.setupId, input.code);
    if (!codeValid) {
      throw new AppError(400, "Wrong code. Try again.", "INVALID_CODE");
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
    user.status = UserStatus.ACTIVE;
    user.securitySetupComplete = true;
    user.invitationTokenHash = null;
    user.invitationExpiresAt = null;
    user.lastSignedInAt = new Date();

    await this.users.save(user);
    await deleteInvitationSetup(input.setupId);

    logger.info(
      { userId: user.id, email: user.email },
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

    logger.info(
      { userId: user.id, email: user.email },
      "User accepted invitation and account activated",
    );

    const tokens = await this.issueTokens(user);
    return { user: toPublicUser(user), tokens };
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const email = input.email.toLowerCase();

    const lock = await getLoginLockStatus(email);
    if (lock.locked) {
      throw new AppError(
        429,
        "Too many attempts. Sign-in is paused for 15 minutes",
        "LOCKED",
        { lockedUntil: lock.lockedUntil },
      );
    }

    const user = await this.users.findOne({ where: { email } });

    if (!user || !user.passwordHash) {
      await recordFailedLoginAttempt(email);
      throw new AppError(401, "Invalid email or password", "INVALID_CREDENTIALS");
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
      const afterFail = await recordFailedLoginAttempt(email);

      if (afterFail.locked) {
        throw new AppError(
          429,
          "Too many attempts. Sign-in is paused for 15 minutes",
          "LOCKED",
          { lockedUntil: afterFail.lockedUntil },
        );
      }

      throw new AppError(401, "Invalid email or password", "INVALID_CREDENTIALS");
    }

    await clearLoginLockout(email);
    user.lastSignedInAt = new Date();
    await this.users.save(user);

    const tokens = await this.issueTokens(user);
    return { user: toPublicUser(user), tokens };
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
      relations: { user: true },
    });

    if (
      !stored ||
      stored.revokedAt ||
      stored.expiresAt < new Date() ||
      !(await verifyHash(rawRefreshToken, stored.tokenHash))
    ) {
      throw new AppError(401, "Invalid or expired refresh token", "INVALID_TOKEN");
    }

    if (stored.user.status !== UserStatus.ACTIVE) {
      throw new AppError(403, "Account is not active", "INACTIVE");
    }

    stored.revokedAt = new Date();
    await this.refreshTokens.save(stored);

    const tokens = await this.issueTokens(stored.user);
    return { user: toPublicUser(stored.user), tokens };
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
      email: user.email,
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
