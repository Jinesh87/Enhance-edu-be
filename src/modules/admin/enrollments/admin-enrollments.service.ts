import { In } from "typeorm";
import { AppDataSource } from "../../../config/data-source.js";
import {
  EnrollmentStatus,
  PendingEnrollmentStatus,
} from "../../../common/constants/enrollment.js";
import { UserRole, UserStatus } from "../../../common/constants/roles.js";
import { AppError } from "../../../common/errors/AppError.js";
import { env } from "../../../config/env.js";
import { logger } from "../../../config/logger.js";
import {
  generateInvitationToken,
  storeInvitationToken,
  deleteUserInvitationTokens,
} from "../../../common/utils/invitation-redis.js";
import {
  Enrollment,
  EnrollmentSubject,
  GuardianStudent,
  PendingEnrollment,
  PendingEnrollmentSubject,
  Student,
  Subject,
  Term,
  User,
} from "../../../entities/index.js";
import { emailService } from "../../email/email.service.js";
import { hashPassword } from "../../../common/utils/password.js";

export type StudentLoginInput = {
  username: string;
  password: string;
};

export type GuardianInput = {
  fullName: string;
  preferredName?: string | null;
  email: string;
  mobile?: string | null;
};

export type StudentInput = {
  fullName: string;
  preferredName?: string | null;
  dateOfBirth?: string | null;
  yearLevel?: number | null;
};

export type EnrollmentInput = {
  termId: string;
  subjectIds: string[];
  fee: number;
};

function toGuardianDto(user: User) {
  return {
    id: user.id,
    fullName: user.fullName,
    preferredName: user.preferredName,
    email: user.email,
    mobile: user.mobile,
    status: user.status,
  };
}

function toStudentDto(student: Student) {
  return {
    id: student.id,
    fullName: student.fullName,
    preferredName: student.preferredName,
    dateOfBirth: student.dateOfBirth,
    yearLevel: student.yearLevel,
    createdAt: student.createdAt,
  };
}

function toEnrollmentDto(
  enrollment: Enrollment,
  subjects: Subject[],
  pendingId?: string,
) {
  return {
    id: enrollment.id,
    pendingId: pendingId ?? null,
    status: enrollment.status,
    fee: Number(enrollment.fee),
    term: enrollment.term
      ? {
          id: enrollment.term.id,
          name: enrollment.term.name,
          startDate: enrollment.term.startDate,
          endDate: enrollment.term.endDate,
        }
      : null,
    subjects: subjects.map((subject) => ({
      id: subject.id,
      name: subject.name,
    })),
    guardian: enrollment.guardian ? toGuardianDto(enrollment.guardian) : null,
    student: enrollment.student ? toStudentDto(enrollment.student) : null,
    createdAt: enrollment.createdAt,
  };
}

function toPendingEnrollmentDto(
  pending: PendingEnrollment,
  subjects: Subject[],
) {
  return {
    id: pending.id,
    pendingId: pending.id,
    status: EnrollmentStatus.AWAITING_GUARDIAN,
    fee: Number(pending.fee),
    term: pending.term
      ? {
          id: pending.term.id,
          name: pending.term.name,
          startDate: pending.term.startDate,
          endDate: pending.term.endDate,
        }
      : null,
    subjects: subjects.map((subject) => ({
      id: subject.id,
      name: subject.name,
    })),
    guardian: pending.guardian ? toGuardianDto(pending.guardian) : null,
    student: {
      id: null,
      fullName: pending.studentFullName,
      preferredName: pending.studentPreferredName,
      dateOfBirth: pending.studentDateOfBirth,
      yearLevel: pending.studentYearLevel,
      createdAt: pending.createdAt,
    },
    createdAt: pending.createdAt,
  };
}

export class AdminEnrollmentsService {
  private readonly users = AppDataSource.getRepository(User);
  private readonly students = AppDataSource.getRepository(Student);
  private readonly guardianStudents = AppDataSource.getRepository(GuardianStudent);
  private readonly enrollments = AppDataSource.getRepository(Enrollment);
  private readonly enrollmentSubjects =
    AppDataSource.getRepository(EnrollmentSubject);
  private readonly pendingEnrollments =
    AppDataSource.getRepository(PendingEnrollment);
  private readonly pendingEnrollmentSubjects = AppDataSource.getRepository(
    PendingEnrollmentSubject,
  );
  private readonly terms = AppDataSource.getRepository(Term);
  private readonly subjects = AppDataSource.getRepository(Subject);

  async list() {
    const [rows, pendingRows] = await Promise.all([
      this.enrollments.find({
        relations: {
          student: true,
          guardian: true,
          term: true,
          subjects: { subject: true },
        },
        order: { createdAt: "DESC" },
      }),
      this.pendingEnrollments.find({
        where: { status: PendingEnrollmentStatus.PENDING },
        relations: {
          guardian: true,
          term: true,
          subjects: { subject: true },
        },
        order: { createdAt: "DESC" },
      }),
    ]);

    const fulfilled = rows.map((row) =>
      toEnrollmentDto(
        row,
        row.subjects?.map((link) => link.subject).filter(Boolean) ?? [],
      ),
    );

    const awaiting = pendingRows.map((row) =>
      toPendingEnrollmentDto(
        row,
        row.subjects?.map((link) => link.subject).filter(Boolean) ?? [],
      ),
    );

    return [...awaiting, ...fulfilled].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  async listPendingStudentsForGuardian(guardianId: string) {
    const pendingRows = await this.pendingEnrollments.find({
      where: {
        guardianId,
        status: PendingEnrollmentStatus.PENDING,
      },
      order: { createdAt: "ASC" },
    });

    return pendingRows.map((row) => ({
      pendingEnrollmentId: row.id,
      fullName: row.studentFullName,
      preferredName: row.studentPreferredName,
      yearLevel: row.studentYearLevel,
    }));
  }

  async inviteWithEnrollment(
    input: {
      guardianId?: string;
      guardian?: GuardianInput;
      student: StudentInput;
      enrollment: EnrollmentInput;
      studentLogin?: StudentLoginInput;
    },
    actorId: string,
  ) {
    const { term, subjectRows } = await this.validateEnrollmentCatalogue(
      input.enrollment,
    );

    const { guardian, invitationSent, invitationToken } = input.guardianId
      ? await this.loadExistingGuardian(input.guardianId)
      : await this.resolveGuardian(input.guardian!);

    if (guardian.status === UserStatus.ACTIVE) {
      if (!input.studentLogin) {
        throw new AppError(
          400,
          "Username and password are required when enrolling for an active guardian",
          "STUDENT_LOGIN_REQUIRED",
        );
      }

      const result = await this.materializeEnrollment(
        guardian,
        input.student,
        input.enrollment,
        term,
        subjectRows,
        actorId,
        input.studentLogin,
      );

      return {
        guardian: toGuardianDto(guardian),
        student: result.student,
        enrollment: result.enrollment,
        invitationSent: false,
        invitationToken,
        awaitingGuardianAcceptance: false,
      };
    }

    const pending = await this.queuePendingEnrollment(
      guardian.id,
      input.student,
      input.enrollment,
      term,
      subjectRows,
      actorId,
    );

    pending.guardian = guardian;
    pending.term = term;

    return {
      guardian: toGuardianDto(guardian),
      student: {
        id: null,
        fullName: pending.studentFullName,
        preferredName: pending.studentPreferredName,
        dateOfBirth: pending.studentDateOfBirth,
        yearLevel: pending.studentYearLevel,
        createdAt: pending.createdAt,
      },
      enrollment: toPendingEnrollmentDto(pending, subjectRows),
      invitationSent,
      invitationToken,
      awaitingGuardianAcceptance: true,
    };
  }

  async queuePendingEnrollmentForGuardian(
    guardianId: string,
    student: StudentInput,
    enrollment: EnrollmentInput,
    actorId: string,
    studentLogin?: StudentLoginInput,
  ) {
    const guardian = await this.users.findOne({ where: { id: guardianId } });
    if (!guardian || guardian.role !== UserRole.GUARDIAN) {
      throw new AppError(404, "Guardian not found", "GUARDIAN_NOT_FOUND");
    }
    if (guardian.status === UserStatus.DEACTIVATED) {
      throw new AppError(
        400,
        "This guardian account is deactivated",
        "GUARDIAN_DEACTIVATED",
      );
    }

    const { term, subjectRows } = await this.validateEnrollmentCatalogue(enrollment);

    if (guardian.status === UserStatus.ACTIVE) {
      if (!studentLogin) {
        throw new AppError(
          400,
          "Username and password are required when enrolling for an active guardian",
          "STUDENT_LOGIN_REQUIRED",
        );
      }
      return this.materializeEnrollment(
        guardian,
        student,
        enrollment,
        term,
        subjectRows,
        actorId,
        studentLogin,
      );
    }

    const pending = await this.queuePendingEnrollment(
      guardian.id,
      student,
      enrollment,
      term,
      subjectRows,
      actorId,
    );
    pending.guardian = guardian;
    pending.term = term;
    return {
      pending,
      subjects: subjectRows,
    };
  }

  async fulfillPendingEnrollmentsForGuardian(
    guardianId: string,
    studentAccounts: {
      pendingEnrollmentId: string;
      username: string;
      passwordHash: string;
    }[],
  ) {
    const pendingRows = await this.pendingEnrollments.find({
      where: {
        guardianId,
        status: PendingEnrollmentStatus.PENDING,
      },
      relations: { subjects: { subject: true }, term: true },
      order: { createdAt: "ASC" },
    });

    if (pendingRows.length === 0) return;

    if (studentAccounts.length !== pendingRows.length) {
      throw new AppError(
        400,
        "Set up login details for every student before continuing",
        "STUDENT_ACCOUNTS_INCOMPLETE",
      );
    }

    const guardian = await this.users.findOne({ where: { id: guardianId } });
    if (!guardian) return;

    for (const pending of pendingRows) {
      const account = studentAccounts.find(
        (row) => row.pendingEnrollmentId === pending.id,
      );
      if (!account) {
        throw new AppError(
          400,
          `Missing login details for ${pending.studentFullName}`,
          "STUDENT_ACCOUNT_MISSING",
        );
      }

      const subjectRows =
        pending.subjects?.map((link) => link.subject).filter(Boolean) ?? [];

      const result = await this.materializeEnrollment(
        guardian,
        {
          fullName: pending.studentFullName,
          preferredName: pending.studentPreferredName,
          dateOfBirth: pending.studentDateOfBirth,
          yearLevel: pending.studentYearLevel,
        },
        {
          termId: pending.termId,
          subjectIds: subjectRows.map((subject) => subject.id),
          fee: Number(pending.fee),
        },
        pending.term,
        subjectRows,
        pending.createdByUserId ?? guardianId,
        {
          username: account.username,
          passwordHash: account.passwordHash,
        },
      );

      pending.status = PendingEnrollmentStatus.FULFILLED;
      pending.fulfilledStudentId = result.student.id;
      pending.fulfilledEnrollmentId = result.enrollment.id;
      await this.pendingEnrollments.save(pending);
    }

    logger.info(
      { guardianId, count: pendingRows.length },
      "Pending enrollments fulfilled after guardian acceptance",
    );
  }

  private async assertUsernameAvailable(username: string) {
    const normalized = username.trim().toLowerCase();
    const existing = await this.users.findOne({
      where: { username: normalized },
    });
    if (existing) {
      throw new AppError(
        409,
        "That username is already taken",
        "USERNAME_IN_USE",
      );
    }
  }

  private async createStudentUserAccount(
    studentInput: StudentInput,
    credentials: { username: string; passwordHash: string },
  ) {
    await this.assertUsernameAvailable(credentials.username);

    const studentUser = this.users.create({
      fullName: studentInput.fullName.trim(),
      preferredName: studentInput.preferredName?.trim() || null,
      email: null,
      username: credentials.username.trim().toLowerCase(),
      mobile: null,
      passwordHash: credentials.passwordHash,
      role: UserRole.STUDENT,
      status: UserStatus.ACTIVE,
      employmentType: null,
      securitySetupComplete: true,
      twoFactorMethod: null,
      authenticatorSecret: null,
      invitationTokenHash: null,
      invitationExpiresAt: null,
    });
    await this.users.save(studentUser);
    return studentUser;
  }

  private async validateEnrollmentCatalogue(enrollment: EnrollmentInput) {
    const term = await this.terms.findOne({ where: { id: enrollment.termId } });
    if (!term) {
      throw new AppError(404, "Term not found", "TERM_NOT_FOUND");
    }

    const subjectRows = await this.subjects.find({
      where: { id: In(enrollment.subjectIds) },
    });
    if (subjectRows.length !== enrollment.subjectIds.length) {
      throw new AppError(
        404,
        "One or more subjects were not found",
        "SUBJECT_NOT_FOUND",
      );
    }

    return { term, subjectRows };
  }

  private async materializeEnrollment(
    guardian: User,
    studentInput: StudentInput,
    enrollmentInput: EnrollmentInput,
    term: Term,
    subjectRows: Subject[],
    actorId: string,
    studentLogin?:
      | StudentLoginInput
      | { username: string; passwordHash: string },
  ) {
    const student = this.students.create({
      fullName: studentInput.fullName.trim(),
      preferredName: studentInput.preferredName?.trim() || null,
      dateOfBirth: studentInput.dateOfBirth?.trim() || null,
      yearLevel: studentInput.yearLevel ?? null,
    });
    await this.students.save(student);

    if (studentLogin) {
      const passwordHash =
        "passwordHash" in studentLogin
          ? studentLogin.passwordHash
          : await hashPassword(studentLogin.password);
      const studentUser = await this.createStudentUserAccount(studentInput, {
        username: studentLogin.username,
        passwordHash,
      });
      student.userId = studentUser.id;
      await this.students.save(student);
    }

    const existingLink = await this.guardianStudents.findOne({
      where: { guardianId: guardian.id, studentId: student.id },
    });
    if (!existingLink) {
      await this.guardianStudents.save(
        this.guardianStudents.create({
          guardianId: guardian.id,
          studentId: student.id,
        }),
      );
    }

    const enrollment = this.enrollments.create({
      studentId: student.id,
      guardianId: guardian.id,
      termId: term.id,
      fee: enrollmentInput.fee.toFixed(2),
      status: EnrollmentStatus.ACTIVE,
      createdByUserId: actorId,
    });
    await this.enrollments.save(enrollment);

    for (const subject of subjectRows) {
      await this.enrollmentSubjects.save(
        this.enrollmentSubjects.create({
          enrollmentId: enrollment.id,
          subjectId: subject.id,
        }),
      );
    }

    enrollment.student = student;
    enrollment.guardian = guardian;
    enrollment.term = term;

    return {
      student: toStudentDto(student),
      enrollment: toEnrollmentDto(enrollment, subjectRows),
    };
  }

  private async queuePendingEnrollment(
    guardianId: string,
    studentInput: StudentInput,
    enrollmentInput: EnrollmentInput,
    term: Term,
    subjectRows: Subject[],
    actorId: string,
  ) {
    const pending = this.pendingEnrollments.create({
      guardianId,
      studentFullName: studentInput.fullName.trim(),
      studentPreferredName: studentInput.preferredName?.trim() || null,
      studentDateOfBirth: studentInput.dateOfBirth?.trim() || null,
      studentYearLevel: studentInput.yearLevel ?? null,
      termId: term.id,
      fee: enrollmentInput.fee.toFixed(2),
      status: PendingEnrollmentStatus.PENDING,
      createdByUserId: actorId,
    });
    await this.pendingEnrollments.save(pending);

    for (const subject of subjectRows) {
      await this.pendingEnrollmentSubjects.save(
        this.pendingEnrollmentSubjects.create({
          pendingEnrollmentId: pending.id,
          subjectId: subject.id,
        }),
      );
    }

    pending.subjects = subjectRows.map((subject) => ({
      pendingEnrollmentId: pending.id,
      subjectId: subject.id,
      subject,
    })) as PendingEnrollmentSubject[];

    return pending;
  }

  private async loadExistingGuardian(guardianId: string) {
    const guardian = await this.users.findOne({ where: { id: guardianId } });

    if (!guardian) {
      throw new AppError(404, "Guardian not found", "GUARDIAN_NOT_FOUND");
    }

    if (guardian.role !== UserRole.GUARDIAN) {
      throw new AppError(400, "Selected user is not a guardian", "NOT_A_GUARDIAN");
    }

    if (guardian.status === UserStatus.DEACTIVATED) {
      throw new AppError(
        400,
        "This guardian account is deactivated",
        "GUARDIAN_DEACTIVATED",
      );
    }

    return { guardian, invitationSent: false, invitationToken: undefined };
  }

  private async resolveGuardian(input: GuardianInput) {
    const email = input.email.trim().toLowerCase();
    let guardian = await this.users.findOne({ where: { email } });
    let invitationSent = false;
    let invitationToken: string | undefined;

    if (guardian) {
      if (guardian.role !== UserRole.GUARDIAN) {
        throw new AppError(
          409,
          `That email is already used by ${guardian.fullName} (${guardian.role})`,
          "EMAIL_IN_USE",
          {
            heldBy: {
              id: guardian.id,
              fullName: guardian.fullName,
              email: guardian.email,
            },
          },
        );
      }

      if (guardian.status === UserStatus.DEACTIVATED) {
        throw new AppError(
          400,
          "This guardian account is deactivated",
          "GUARDIAN_DEACTIVATED",
        );
      }

      guardian.fullName = input.fullName.trim();
      guardian.preferredName =
        input.preferredName?.trim() || guardian.preferredName;
      if (input.mobile !== undefined) {
        guardian.mobile = input.mobile?.trim() || null;
      }
      await this.users.save(guardian);

      if (guardian.status === UserStatus.INVITED) {
        const invite = await this.sendGuardianInvitation(guardian);
        invitationSent = true;
        invitationToken = invite.invitationToken;
      }

      return { guardian, invitationSent, invitationToken };
    }

    guardian = this.users.create({
      fullName: input.fullName.trim(),
      preferredName: input.preferredName?.trim() || null,
      email,
      mobile: input.mobile?.trim() || null,
      passwordHash: null,
      role: UserRole.GUARDIAN,
      status: UserStatus.INVITED,
      employmentType: null,
      securitySetupComplete: false,
      invitationTokenHash: null,
      invitationExpiresAt: null,
    });
    await this.users.save(guardian);

    const invite = await this.sendGuardianInvitation(guardian);
    invitationSent = true;
    invitationToken = invite.invitationToken;

    return { guardian, invitationSent, invitationToken };
  }

  private async sendGuardianInvitation(guardian: User) {
    if (!guardian.email) {
      throw new AppError(
        400,
        "Guardian email is required to send an invitation",
        "EMAIL_REQUIRED",
      );
    }

    await deleteUserInvitationTokens(guardian.id);
    const invitationToken = generateInvitationToken();
    await storeInvitationToken(invitationToken, {
      userId: guardian.id,
      email: guardian.email,
      fullName: guardian.fullName,
    });

    const invitationLink = `${env.FRONTEND_URL}/accept-invitation?token=${invitationToken}`;

    try {
      await emailService.sendInvitationEmail({
        to: guardian.email,
        fullName: guardian.fullName,
        invitationLink,
      });
      logger.info(
        { userId: guardian.id, email: guardian.email },
        "Guardian invitation email sent",
      );
    } catch (error) {
      logger.warn(
        { userId: guardian.id, err: error },
        "Failed to send guardian invitation email",
      );
    }

    return { invitationToken };
  }
}

export const adminEnrollmentsService = new AdminEnrollmentsService();
