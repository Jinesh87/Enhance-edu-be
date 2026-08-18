import { In, IsNull } from "typeorm";
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
import type { EnrollmentSnapshot } from "../../../entities/PendingEnrollment.js";
import { emailService } from "../../email/email.service.js";
import type { InvitationEnrollmentDetails } from "../../email/email.service.js";
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

function termDto(term: Term | null) {
  if (!term) return null;
  return {
    id: term.id,
    name:
      term.academicYear && term.yearLevel
        ? `${term.name} · ${term.academicYear.year} · ${term.yearLevel.name}`
        : term.name,
    startDate: term.startDate,
    endDate: term.endDate,
  };
}

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
    term: termDto(enrollment.term),
    subjects: subjects.map((subject) => ({
      id: subject.id,
      name: subject.name,
    })),
    guardian: enrollment.guardian ? toGuardianDto(enrollment.guardian) : null,
    student: enrollment.student ? toStudentDto(enrollment.student) : null,
    createdAt: enrollment.createdAt,
    isModification: false,
    replacesEnrollmentId: null as string | null,
    previous: null as EnrollmentSnapshot | null,
    hasPendingModification: false,
    pendingModification: null as ReturnType<typeof toPendingEnrollmentDto> | null,
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
    term: termDto(pending.term),
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
    isModification: Boolean(pending.replacesEnrollmentId),
    replacesEnrollmentId: pending.replacesEnrollmentId,
    previous: pending.previousSnapshot ?? null,
    hasPendingModification: false,
    pendingModification: null,
  };
}

function snapshotFromEnrollment(
  enrollment: Enrollment,
  subjects: Subject[],
): EnrollmentSnapshot {
  return {
    student: enrollment.student ? toStudentDto(enrollment.student) : null,
    term: termDto(enrollment.term),
    subjects: subjects.map((subject) => ({
      id: subject.id,
      name: subject.name,
    })),
    fee: Number(enrollment.fee),
  };
}

function snapshotFromPending(
  pending: PendingEnrollment,
  subjects: Subject[],
): EnrollmentSnapshot {
  return {
    student: {
      id: null,
      fullName: pending.studentFullName,
      preferredName: pending.studentPreferredName,
      dateOfBirth: pending.studentDateOfBirth,
      yearLevel: pending.studentYearLevel,
      createdAt: pending.createdAt,
    },
    term: termDto(pending.term),
    subjects: subjects.map((subject) => ({
      id: subject.id,
      name: subject.name,
    })),
    fee: Number(pending.fee),
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

  async list(filters?: { page?: number; limit?: number }) {
    const [rows, pendingRows] = await Promise.all([
      this.enrollments.find({
        relations: {
          student: true,
          guardian: true,
          term: { academicYear: true, yearLevel: true },
          subjects: { subject: true },
        },
        order: { createdAt: "DESC" },
      }),
      this.pendingEnrollments.find({
        where: { status: PendingEnrollmentStatus.PENDING },
        relations: {
          guardian: true,
          term: { academicYear: true, yearLevel: true },
          subjects: { subject: true },
        },
        order: { createdAt: "DESC" },
      }),
    ]);

    const fulfilled = rows.map((row) => {
      const dto = toEnrollmentDto(
        row,
        row.subjects?.map((link) => link.subject).filter(Boolean) ?? [],
      );
      const modification = pendingRows.find(
        (pending) => pending.replacesEnrollmentId === row.id,
      );
      if (modification) {
        dto.hasPendingModification = true;
        dto.pendingModification = toPendingEnrollmentDto(
          modification,
          modification.subjects?.map((link) => link.subject).filter(Boolean) ?? [],
        );
        dto.previous = modification.previousSnapshot ?? snapshotFromEnrollment(
          row,
          row.subjects?.map((link) => link.subject).filter(Boolean) ?? [],
        );
      }
      return dto;
    });

    const awaiting = pendingRows
      .filter((row) => !row.replacesEnrollmentId)
      .map((row) =>
        toPendingEnrollmentDto(
          row,
          row.subjects?.map((link) => link.subject).filter(Boolean) ?? [],
        ),
      );

    let all = [...awaiting, ...fulfilled].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const total = all.length;

    if (filters?.page && filters?.limit) {
      const start = (filters.page - 1) * filters.limit;
      all = all.slice(start, start + filters.limit);
    }

    return { enrollments: all, total };
  }

  async getById(id: string) {
    const enrollment = await this.enrollments.findOne({
      where: { id },
      relations: {
        student: true,
        guardian: true,
        term: { academicYear: true, yearLevel: true },
        subjects: { subject: true },
      },
    });

    if (enrollment) {
      const subjects =
        enrollment.subjects?.map((link) => link.subject).filter(Boolean) ?? [];
      const dto = toEnrollmentDto(enrollment, subjects);
      const modification = await this.pendingEnrollments.findOne({
        where: {
          replacesEnrollmentId: enrollment.id,
          status: PendingEnrollmentStatus.PENDING,
        },
        relations: {
          guardian: true,
          term: { academicYear: true, yearLevel: true },
          subjects: { subject: true },
        },
      });
      if (modification) {
        const modificationSubjects =
          modification.subjects?.map((link) => link.subject).filter(Boolean) ??
          [];
        dto.hasPendingModification = true;
        dto.pendingModification = toPendingEnrollmentDto(
          modification,
          modificationSubjects,
        );
        dto.previous =
          modification.previousSnapshot ??
          snapshotFromEnrollment(enrollment, subjects);
      }
      return dto;
    }

    const pending = await this.pendingEnrollments.findOne({
      where: { id },
      relations: {
        guardian: true,
        term: { academicYear: true, yearLevel: true },
        subjects: { subject: true },
      },
    });
    if (!pending) {
      throw new AppError(404, "Enrolment not found", "ENROLLMENT_NOT_FOUND");
    }

    return toPendingEnrollmentDto(
      pending,
      pending.subjects?.map((link) => link.subject).filter(Boolean) ?? [],
    );
  }

  async proposeModification(
    id: string,
    input: { student: StudentInput; enrollment: EnrollmentInput },
    actorId: string,
  ) {
    const { term, subjectRows } = await this.validateEnrollmentCatalogue(
      input.enrollment,
    );

    const enrollment = await this.enrollments.findOne({
      where: { id },
      relations: {
        student: true,
        guardian: true,
        term: { academicYear: true, yearLevel: true },
        subjects: { subject: true },
      },
    });

    if (enrollment) {
      const currentSubjects =
        enrollment.subjects?.map((link) => link.subject).filter(Boolean) ?? [];
      const snapshot = snapshotFromEnrollment(enrollment, currentSubjects);

      let pending = await this.pendingEnrollments.findOne({
        where: {
          replacesEnrollmentId: enrollment.id,
          status: PendingEnrollmentStatus.PENDING,
        },
        relations: { subjects: true },
      });

      if (pending) {
        await this.updatePendingEnrollment(
          pending,
          input.student,
          input.enrollment,
          term,
          subjectRows,
          snapshot,
        );
      } else {
        pending = await this.queuePendingEnrollment(
          enrollment.guardianId,
          input.student,
          input.enrollment,
          term,
          subjectRows,
          actorId,
          {
            replacesEnrollmentId: enrollment.id,
            previousSnapshot: snapshot,
          },
        );
      }

      pending.guardian = enrollment.guardian;
      pending.term = term;
      await this.notifyGuardianOfChange(enrollment.guardian, pending, subjectRows);

      return {
        enrollment: toEnrollmentDto(enrollment, currentSubjects),
        pendingModification: toPendingEnrollmentDto(pending, subjectRows),
        awaitingGuardianAcceptance: true,
      };
    }

    const pending = await this.pendingEnrollments.findOne({
      where: { id, status: PendingEnrollmentStatus.PENDING },
      relations: {
        guardian: true,
        term: { academicYear: true, yearLevel: true },
        subjects: { subject: true },
      },
    });
    if (!pending) {
      throw new AppError(404, "Enrolment not found", "ENROLLMENT_NOT_FOUND");
    }

    const currentSubjects =
      pending.subjects?.map((link) => link.subject).filter(Boolean) ?? [];
    const snapshot =
      pending.previousSnapshot ?? snapshotFromPending(pending, currentSubjects);

    await this.updatePendingEnrollment(
      pending,
      input.student,
      input.enrollment,
      term,
      subjectRows,
      snapshot,
    );
    pending.guardian = pending.guardian;
    pending.term = term;
    await this.notifyGuardianOfChange(pending.guardian, pending, subjectRows);

    return {
      enrollment: toPendingEnrollmentDto(pending, subjectRows),
      pendingModification: null,
      awaitingGuardianAcceptance: true,
    };
  }

  async acceptPendingEnrollment(pendingId: string, guardianId: string) {
    const pending = await this.pendingEnrollments.findOne({
      where: {
        id: pendingId,
        guardianId,
        status: PendingEnrollmentStatus.PENDING,
      },
      relations: {
        subjects: { subject: true },
        term: { academicYear: true, yearLevel: true },
        guardian: true,
      },
    });
    if (!pending) {
      throw new AppError(
        404,
        "Pending enrolment change not found",
        "PENDING_ENROLLMENT_NOT_FOUND",
      );
    }

    if (pending.replacesEnrollmentId) {
      return this.applyModification(pending);
    }

    throw new AppError(
      400,
      "This enrolment still needs student login setup during invitation acceptance",
      "STUDENT_LOGIN_REQUIRED",
    );
  }

  async listPendingStudentsForGuardian(guardianId: string) {
    const pendingRows = await this.pendingEnrollments.find({
      where: {
        guardianId,
        status: PendingEnrollmentStatus.PENDING,
        replacesEnrollmentId: IsNull(),
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

  async listConnectedStudentsForGuardian(guardianId: string) {
    const [links, pendingRows] = await Promise.all([
      this.guardianStudents.find({
        where: { guardianId },
        relations: { student: true },
        order: { createdAt: "DESC" },
      }),
      this.pendingEnrollments.find({
        where: {
          guardianId,
          status: PendingEnrollmentStatus.PENDING,
        },
        relations: {
          term: { academicYear: true, yearLevel: true },
          subjects: { subject: true },
        },
        order: { createdAt: "DESC" },
      }),
    ]);

    const studentIds = links.map((link) => link.studentId);
    const enrollmentRows = studentIds.length
      ? await this.enrollments.find({
          where: { guardianId, studentId: In(studentIds) },
          relations: {
            term: { academicYear: true, yearLevel: true },
            subjects: { subject: true },
          },
          order: { createdAt: "DESC" },
        })
      : [];

    const enrollmentsByStudent = new Map<string, Enrollment[]>();
    for (const enrollment of enrollmentRows) {
      const current = enrollmentsByStudent.get(enrollment.studentId) ?? [];
      current.push(enrollment);
      enrollmentsByStudent.set(enrollment.studentId, current);
    }

    const linked = links.map((link) => {
      const enrollments = enrollmentsByStudent.get(link.studentId) ?? [];
      return {
        id: link.student.id,
        fullName: link.student.fullName,
        preferredName: link.student.preferredName,
        dateOfBirth: link.student.dateOfBirth,
        yearLevel: link.student.yearLevel,
        status: "LINKED" as const,
        enrollments: enrollments.map((enrollment) => ({
          id: enrollment.id,
          status: enrollment.status,
          fee: Number(enrollment.fee),
          term: enrollment.term
            ? {
                id: enrollment.term.id,
                name:
                  enrollment.term.academicYear && enrollment.term.yearLevel
                    ? `${enrollment.term.name} · ${enrollment.term.academicYear.year} · ${enrollment.term.yearLevel.name}`
                    : enrollment.term.name,
              }
            : null,
          subjects:
            enrollment.subjects
              ?.map((row) => row.subject)
              .filter(Boolean)
              .map((subject) => ({ id: subject.id, name: subject.name })) ?? [],
        })),
      };
    });

    const pending = pendingRows.map((row) => ({
      id: null as string | null,
      fullName: row.studentFullName,
      preferredName: row.studentPreferredName,
      dateOfBirth: row.studentDateOfBirth,
      yearLevel: row.studentYearLevel,
      status: "AWAITING_GUARDIAN" as const,
      enrollments: [
        {
          id: row.id,
          status: EnrollmentStatus.AWAITING_GUARDIAN,
          fee: Number(row.fee),
          term: row.term
            ? {
                id: row.term.id,
                name:
                  row.term.academicYear && row.term.yearLevel
                    ? `${row.term.name} · ${row.term.academicYear.year} · ${row.term.yearLevel.name}`
                    : row.term.name,
              }
            : null,
          subjects:
            row.subjects
              ?.map((link) => link.subject)
              .filter(Boolean)
              .map((subject) => ({ id: subject.id, name: subject.name })) ?? [],
        },
      ],
    }));

    return [...pending, ...linked];
  }

  async listGuardiansForStudentUser(userId: string) {
    const student = await this.students.findOne({ where: { userId } });
    if (!student) {
      return [];
    }

    const links = await this.guardianStudents.find({
      where: { studentId: student.id },
      relations: { guardian: true },
      order: { createdAt: "DESC" },
    });

    return links
      .filter((link) => Boolean(link.guardian))
      .map((link) => ({
        id: link.guardian.id,
        fullName: link.guardian.fullName,
        preferredName: link.guardian.preferredName,
        email: link.guardian.email,
        mobile: link.guardian.mobile,
        status: link.guardian.status,
      }));
  }

  async listPendingEnrollmentEmailDetails(
    guardianId: string,
  ): Promise<InvitationEnrollmentDetails[]> {
    const pendingRows = await this.pendingEnrollments.find({
      where: {
        guardianId,
        status: PendingEnrollmentStatus.PENDING,
      },
      relations: {
        term: { academicYear: true, yearLevel: true },
        subjects: { subject: true },
      },
      order: { createdAt: "ASC" },
    });

    return pendingRows.map((row) => ({
      studentFullName: row.studentFullName,
      studentPreferredName: row.studentPreferredName,
      yearLevel: row.studentYearLevel,
      termName: row.term
        ? (row.term.academicYear && row.term.yearLevel
          ? `${row.term.name} · ${row.term.academicYear.year} · ${row.term.yearLevel.name}`
          : row.term.name)
        : "Term",
      termStartDate: row.term?.startDate ?? "",
      termEndDate: row.term?.endDate ?? "",
      subjects:
        row.subjects?.map((link) => link.subject?.name).filter(Boolean) ?? [],
      fee: Number(row.fee),
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

    const { guardian } = input.guardianId
      ? await this.loadExistingGuardian(input.guardianId)
      : await this.resolveGuardian(input.guardian!);

    if (guardian.status === UserStatus.ACTIVE) {
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
        invitationToken: undefined,
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

    let invitationSent = false;
    let invitationToken: string | undefined;
    if (guardian.status === UserStatus.INVITED) {
      const invite = await this.sendGuardianInvitation(guardian);
      invitationSent = true;
      invitationToken = invite.invitationToken;
    }

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
      relations: { subjects: { subject: true }, term: { academicYear: true, yearLevel: true } },
      order: { createdAt: "ASC" },
    });

    if (pendingRows.length === 0) return;

    const modifications = pendingRows.filter((row) => row.replacesEnrollmentId);
    const freshRows = pendingRows.filter((row) => !row.replacesEnrollmentId);

    for (const pending of modifications) {
      await this.applyModification(pending);
    }

    if (freshRows.length === 0) return;

    if (studentAccounts.length !== freshRows.length) {
      throw new AppError(
        400,
        "Set up login details for every student before continuing",
        "STUDENT_ACCOUNTS_INCOMPLETE",
      );
    }

    const guardian = await this.users.findOne({ where: { id: guardianId } });
    if (!guardian) return;

    for (const pending of freshRows) {
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
    options?: {
      replacesEnrollmentId?: string | null;
      previousSnapshot?: EnrollmentSnapshot | null;
    },
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
      replacesEnrollmentId: options?.replacesEnrollmentId ?? null,
      previousSnapshot: options?.previousSnapshot ?? null,
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

  private async updatePendingEnrollment(
    pending: PendingEnrollment,
    studentInput: StudentInput,
    enrollmentInput: EnrollmentInput,
    term: Term,
    subjectRows: Subject[],
    previousSnapshot: EnrollmentSnapshot,
  ) {
    pending.studentFullName = studentInput.fullName.trim();
    pending.studentPreferredName = studentInput.preferredName?.trim() || null;
    pending.studentDateOfBirth = studentInput.dateOfBirth?.trim() || null;
    pending.studentYearLevel = studentInput.yearLevel ?? null;
    pending.termId = term.id;
    pending.fee = enrollmentInput.fee.toFixed(2);
    pending.previousSnapshot = previousSnapshot;
    await this.pendingEnrollments.save(pending);

    await this.pendingEnrollmentSubjects.delete({
      pendingEnrollmentId: pending.id,
    });
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
    pending.term = term;
  }

  private async applyModification(pending: PendingEnrollment) {
    if (!pending.replacesEnrollmentId) {
      throw new AppError(
        400,
        "This pending enrolment is not a modification",
        "NOT_A_MODIFICATION",
      );
    }

    const enrollment = await this.enrollments.findOne({
      where: { id: pending.replacesEnrollmentId },
      relations: { student: true, subjects: true },
    });
    if (!enrollment) {
      throw new AppError(404, "Enrolment not found", "ENROLLMENT_NOT_FOUND");
    }

    const subjectRows =
      pending.subjects?.map((link) => link.subject).filter(Boolean) ?? [];

    if (enrollment.student) {
      enrollment.student.fullName = pending.studentFullName;
      enrollment.student.preferredName = pending.studentPreferredName;
      enrollment.student.dateOfBirth = pending.studentDateOfBirth;
      enrollment.student.yearLevel = pending.studentYearLevel;
      await this.students.save(enrollment.student);
    }

    enrollment.termId = pending.termId;
    enrollment.fee = pending.fee;
    await this.enrollments.save(enrollment);

    await this.enrollmentSubjects.delete({ enrollmentId: enrollment.id });
    for (const subject of subjectRows) {
      await this.enrollmentSubjects.save(
        this.enrollmentSubjects.create({
          enrollmentId: enrollment.id,
          subjectId: subject.id,
        }),
      );
    }

    pending.status = PendingEnrollmentStatus.FULFILLED;
    pending.fulfilledStudentId = enrollment.studentId;
    pending.fulfilledEnrollmentId = enrollment.id;
    await this.pendingEnrollments.save(pending);

    return { enrollment, student: enrollment.student };
  }

  private async notifyGuardianOfChange(
    guardian: User | null,
    pending: PendingEnrollment,
    _subjectRows: Subject[],
  ) {
    if (!guardian?.email || guardian.status !== UserStatus.ACTIVE) {
      return;
    }

    try {
      await emailService.sendEnrollmentChangeEmail({
        to: guardian.email,
        fullName: guardian.fullName,
        studentFullName: pending.studentFullName,
        reviewLink: `${env.FRONTEND_URL}/guardian/students`,
      });
    } catch (error) {
      logger.warn(
        { guardianId: guardian.id, err: error },
        "Failed to send enrolment change email",
      );
    }
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

      return { guardian };
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

    return { guardian };
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
    const enrollments =
      await this.listPendingEnrollmentEmailDetails(guardian.id);

    try {
      await emailService.sendInvitationEmail({
        to: guardian.email,
        fullName: guardian.fullName,
        invitationLink,
        roleLabel: "Guardian",
        enrollments,
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
