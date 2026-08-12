import {
  EmploymentType,
  UserRole,
  UserStatus,
} from "../../../common/constants/roles.js";

export type PersonDto = {
  id: string;
  fullName: string;
  preferredName: string | null;
  email: string;
  mobile: string | null;
  role: UserRole;
  employmentType: EmploymentType | null;
  securitySetupComplete: boolean;
  status: UserStatus;
  lastSignedInAt: Date | null;
  invitationExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type InvitePersonInput = {
  fullName: string;
  preferredName?: string | null;
  email: string;
  mobile?: string | null;
  role: UserRole;
  employmentType?: EmploymentType | null;
};

export type UpdatePersonInput = {
  fullName?: string;
  preferredName?: string | null;
  email?: string;
  mobile?: string | null;
  role?: UserRole;
  employmentType?: EmploymentType | null;
  status?: UserStatus.ACTIVE | UserStatus.DEACTIVATED;
};

export type ListPeopleFilters = {
  status?: UserStatus;
  role?: UserRole;
};

export type InvitePersonResult = {
  person: PersonDto;
  invitationToken: string;
};
