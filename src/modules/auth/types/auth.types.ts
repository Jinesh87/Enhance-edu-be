import { UserRole, UserStatus } from "../../../common/constants/roles.js";
import type { TwoFactorMethod } from "../../../common/constants/roles.js";

export type PublicUser = {
  id: string;
  fullName: string;
  preferredName: string | null;
  email: string | null;
  username: string | null;
  mobile: string | null;
  role: UserRole;
  modulePermissions: string[];
  status: UserStatus;
  securitySetupComplete: boolean;
  lastSignedInAt: Date | null;
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

export type LoginLockStatus = {
  locked: boolean;
  lockedUntil: Date | null;
};

export type AcceptInvitationInput = {
  email: string;
  token: string;
  password: string;
  preferredName?: string | null;
};

export type InvitationPreview = {
  email: string;
  fullName: string;
  role: UserRole;
  email2faAvailable: boolean;
  sms2faAvailable: boolean;
  authenticator2faAvailable: boolean;
  pendingStudents: {
    pendingEnrollmentId: string;
    fullName: string;
    preferredName: string | null;
    yearLevel: number | null;
  }[];
};

export type InvitationPasswordInput = {
  email: string;
  token: string;
  password: string;
  preferredName?: string | null;
};

export type InvitationPasswordResult = {
  setupId: string;
  email: string;
  fullName: string;
  role: UserRole;
  pendingStudents: InvitationPreview["pendingStudents"];
};

export type InvitationStudentAccountsInput = {
  setupId: string;
  students: {
    pendingEnrollmentId: string;
    username: string;
    password: string;
    confirmPassword: string;
  }[];
};

export type InvitationStudentAccountsResult = {
  setupId: string;
  configuredCount: number;
};

export type Invitation2faMethodInput = {
  setupId: string;
  method: TwoFactorMethod;
  mobile?: string | null;
};

export type Invitation2faMethodResult = {
  setupId: string;
  method: TwoFactorMethod;
  codeSent: boolean;
  otpauthUrl?: string;
  authenticatorSecret?: string;
};

export type Login2faRequiredResult = {
  requires2fa: true;
  challengeId: string;
  method: TwoFactorMethod;
  codeSent: boolean;
};

export type LoginResult = AuthResult | Login2faRequiredResult;

export type InvitationVerify2faInput = {
  setupId: string;
  code: string;
};

export type LoginInput = {
  identifier: string;
  password: string;
};

export type ForgotPasswordInput = {
  email: string;
};

export type ResetPasswordInput = {
  token: string;
  password: string;
};

export type AuthResult = {
  user: PublicUser;
  tokens: AuthTokens;
};
