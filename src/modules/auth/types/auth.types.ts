import { UserRole, UserStatus } from "../../../common/constants/roles.js";
import type { TwoFactorMethod } from "../../../common/constants/roles.js";

export type PublicUser = {
  id: string;
  fullName: string;
  preferredName: string | null;
  email: string;
  mobile: string | null;
  role: UserRole;
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
};

export type InvitationVerify2faInput = {
  setupId: string;
  code: string;
};

export type LoginInput = {
  email: string;
  password: string;
};

export type AuthResult = {
  user: PublicUser;
  tokens: AuthTokens;
};
