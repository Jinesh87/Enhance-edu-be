import {
  EmploymentType,
  UserRole,
  UserStatus,
} from "../../../common/constants/roles.js";

export type PersonDto = {
  id: string;
  fullName: string;
  preferredName: string | null;
  email: string | null;
  mobile: string | null;
  role: UserRole;
  employmentType: EmploymentType | null;
  securitySetupComplete: boolean;
  status: UserStatus;
  lastSignedInAt: Date | null;
  invitationExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  subjectIds?: string[];
};

export type EnrollmentStudentInput = {
  fullName: string;
  preferredName?: string | null;
  dateOfBirth?: string | null;
  yearLevel?: number | null;
};

export type EnrollmentDetailsInput = {
  termId: string;
  subjectIds: string[];
  fee: number;
};

export type InvitePersonInput = {
  fullName: string;
  preferredName?: string | null;
  email: string;
  mobile?: string | null;
  role: UserRole;
  employmentType?: EmploymentType | null;
  student?: EnrollmentStudentInput;
  enrollment?: EnrollmentDetailsInput;
  subjectIds?: string[];
};

export type UpdatePersonInput = {
  fullName?: string;
  preferredName?: string | null;
  email?: string;
  mobile?: string | null;
  role?: UserRole;
  employmentType?: EmploymentType | null;
  status?: UserStatus.ACTIVE | UserStatus.DEACTIVATED;
  subjectIds?: string[];
};

export type ListPeopleFilters = {
  status?: UserStatus;
  role?: UserRole;
  page?: number;
  limit?: number;
};

export type InvitePersonResult = {
  person: PersonDto;
  invitationToken: string;
  pendingEnrollment?: {
    studentFullName: string;
    status: "AWAITING_GUARDIAN";
  };
};
