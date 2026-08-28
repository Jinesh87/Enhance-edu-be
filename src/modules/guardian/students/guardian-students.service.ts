import { In, IsNull } from "typeorm";
import { AppDataSource } from "../../../config/data-source.js";
import { AppError } from "../../../common/errors/AppError.js";
import { UserRole } from "../../../common/constants/roles.js";
import {
  Enrollment,
  GuardianStudent,
  PendingEnrollment,
  Student,
  User,
} from "../../../entities/index.js";
import { PendingEnrollmentStatus } from "../../../common/constants/enrollment.js";
import { hashPassword } from "../../../common/utils/password.js";
import { deleteUserPasswordResetTokens } from "../../../common/utils/password-reset-redis.js";
import { adminEnrollmentsService } from "../../admin/enrollments/admin-enrollments.service.js";
import { logger } from "../../../config/logger.js";

function toStudentDto(
  link: GuardianStudent,
  enrollments: Enrollment[],
  account: User | null,
  pendingByEnrollment: Map<string, PendingEnrollment>,
) {
  const student = link.student;
  return {
    id: student.id,
    fullName: student.fullName,
    preferredName: student.preferredName,
    dateOfBirth: student.dateOfBirth,
    yearLevel: student.yearLevel,
    username: account?.username ?? null,
    enrollments: enrollments.map((enrollment) => {
      const pending = pendingByEnrollment.get(enrollment.id);
      const pendingSubjects =
        pending?.subjects
          ?.map((row) => row.subject)
          .filter(Boolean)
          .map((subject) => ({ id: subject.id, name: subject.name })) ?? [];
      return {
        id: enrollment.id,
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
        subjects:
          enrollment.subjects
            ?.map((row) => row.subject)
            .filter(Boolean)
            .map((subject) => ({ id: subject.id, name: subject.name })) ?? [],
        hasPendingModification: Boolean(pending),
        pendingModification: pending
          ? {
              id: pending.id,
              status: "AWAITING_GUARDIAN" as const,
              fee: Number(pending.fee),
              term: pending.term
                ? {
                    id: pending.term.id,
                    name: pending.term.name,
                    startDate: pending.term.startDate,
                    endDate: pending.term.endDate,
                  }
                : null,
              subjects: pendingSubjects,
              previous: pending.previousSnapshot,
              student: {
                fullName: pending.studentFullName,
                preferredName: pending.studentPreferredName,
                dateOfBirth: pending.studentDateOfBirth,
                yearLevel: pending.studentYearLevel,
              },
            }
          : null,
      };
    }),
  };
}

function toPendingEnrollmentDto(row: PendingEnrollment) {
  return {
    id: row.id,
    studentFullName: row.studentFullName,
    studentPreferredName: row.studentPreferredName,
    studentDateOfBirth: row.studentDateOfBirth,
    studentYearLevel: row.studentYearLevel,
    fee: Number(row.fee),
    term: row.term
      ? {
          id: row.term.id,
          name: row.term.name,
          startDate: row.term.startDate,
          endDate: row.term.endDate,
        }
      : null,
    subjects:
      row.subjects
        ?.map((link) => link.subject)
        .filter(Boolean)
        .map((subject) => ({ id: subject.id, name: subject.name })) ?? [],
  };
}

export class GuardianStudentsService {
  private readonly links = AppDataSource.getRepository(GuardianStudent);
  private readonly enrollments = AppDataSource.getRepository(Enrollment);
  private readonly pendingEnrollments = AppDataSource.getRepository(PendingEnrollment);
  private readonly users = AppDataSource.getRepository(User);

  async listForGuardian(guardianId: string) {
    const [links, freshPendingRows] = await Promise.all([
      this.links.find({
        where: { guardianId },
        relations: { student: true },
        order: { createdAt: "DESC" },
      }),
      this.pendingEnrollments.find({
        where: {
          guardianId,
          status: PendingEnrollmentStatus.PENDING,
          replacesEnrollmentId: IsNull(),
        },
        relations: {
          term: true,
          subjects: { subject: true },
        },
        order: { createdAt: "DESC" },
      }),
    ]);

    if (links.length === 0) {
      const pendingEnrollments = await Promise.all(
        freshPendingRows.map(async (row) => {
          const existingStudentId =
            row.existingStudentId ??
            (await adminEnrollmentsService.resolveExistingStudentWithLogin(
              guardianId,
              row.studentFullName,
            ));
          return {
            ...toPendingEnrollmentDto(row),
            existingStudentId,
            requiresLogin: !existingStudentId,
          };
        }),
      );
      return { students: [], pendingEnrollments };
    }

    const studentIds = links.map((link) => link.studentId);
    for (const studentId of studentIds) {
      await adminEnrollmentsService.reconcileTrialEnrollmentsForStudent(
        guardianId,
        studentId,
      );
    }

    const userIds = links
      .map((link) => link.student.userId)
      .filter((id): id is string => Boolean(id));

    const [enrollmentRows, accounts, pendingRowsAfterReconcile] =
      await Promise.all([
        this.enrollments.find({
          where: { guardianId, studentId: In(studentIds) },
          relations: {
            term: true,
            subjects: { subject: true },
          },
          order: { createdAt: "DESC" },
        }),
        userIds.length
          ? this.users.find({ where: { id: In(userIds) } })
          : Promise.resolve([] as User[]),
        this.pendingEnrollments.find({
          where: {
            guardianId,
            status: PendingEnrollmentStatus.PENDING,
            replacesEnrollmentId: IsNull(),
          },
          relations: {
            term: true,
            subjects: { subject: true },
          },
          order: { createdAt: "DESC" },
        }),
      ]);

    const activePendingRows: PendingEnrollment[] = [];
    for (const row of pendingRowsAfterReconcile) {
      const existingStudentId =
        row.existingStudentId ??
        (await adminEnrollmentsService.resolveExistingStudentWithLogin(
          guardianId,
          row.studentFullName,
        ));
      const alreadyEnrolled =
        existingStudentId &&
        enrollmentRows.some(
          (enrollment) =>
            enrollment.studentId === existingStudentId &&
            enrollment.termId === row.termId,
        );
      if (alreadyEnrolled && existingStudentId) {
        const existingEnrollment = enrollmentRows.find(
          (enrollment) =>
            enrollment.studentId === existingStudentId &&
            enrollment.termId === row.termId,
        );
        row.status = PendingEnrollmentStatus.FULFILLED;
        row.fulfilledStudentId = existingStudentId;
        row.fulfilledEnrollmentId = existingEnrollment?.id ?? null;
        row.existingStudentId = existingStudentId;
        await this.pendingEnrollments.save(row);
        continue;
      }
      activePendingRows.push(row);
    }

    const pendingEnrollments = await Promise.all(
      activePendingRows.map(async (row) => {
        const existingStudentId =
          row.existingStudentId ??
          (await adminEnrollmentsService.resolveExistingStudentWithLogin(
            guardianId,
            row.studentFullName,
          ));
        return {
          ...toPendingEnrollmentDto(row),
          existingStudentId,
          requiresLogin: !existingStudentId,
        };
      }),
    );

    const pendingMods =
      enrollmentRows.length === 0
        ? []
        : await this.pendingEnrollments.find({
            where: {
              guardianId,
              status: PendingEnrollmentStatus.PENDING,
              replacesEnrollmentId: In(enrollmentRows.map((row) => row.id)),
            },
            relations: {
              term: true,
              subjects: { subject: true },
            },
          });

    const pendingByEnrollment = new Map(
      pendingMods
        .filter((row) => row.replacesEnrollmentId)
        .map((row) => [row.replacesEnrollmentId as string, row]),
    );

    const accountsById = new Map(accounts.map((user) => [user.id, user]));
    const enrollmentsByStudent = new Map<string, Enrollment[]>();
    for (const enrollment of enrollmentRows) {
      const current = enrollmentsByStudent.get(enrollment.studentId) ?? [];
      current.push(enrollment);
      enrollmentsByStudent.set(enrollment.studentId, current);
    }

    const students = links.map((link) =>
      toStudentDto(
        link,
        enrollmentsByStudent.get(link.studentId) ?? [],
        link.student.userId
          ? accountsById.get(link.student.userId) ?? null
          : null,
        pendingByEnrollment,
      ),
    );

    return { students, pendingEnrollments };
  }

  async acceptPendingEnrollment(
    guardianId: string,
    pendingId: string,
    studentLogin?: { username: string; password: string },
  ) {
    return adminEnrollmentsService.acceptPendingEnrollment(
      pendingId,
      guardianId,
      studentLogin,
    );
  }

  async updateStudentPassword(
    guardianId: string,
    studentId: string,
    password: string,
  ) {
    const link = await this.links.findOne({
      where: { guardianId, studentId },
      relations: { student: true },
    });
    if (!link) {
      throw new AppError(404, "Student not found", "STUDENT_NOT_FOUND");
    }

    const student = link.student as Student;
    if (!student.userId) {
      throw new AppError(
        400,
        "This student does not have a login account yet",
        "STUDENT_LOGIN_MISSING",
      );
    }

    const account = await this.users.findOne({ where: { id: student.userId } });
    if (!account || account.role !== UserRole.STUDENT) {
      throw new AppError(
        404,
        "Student login account not found",
        "STUDENT_ACCOUNT_NOT_FOUND",
      );
    }

    account.passwordHash = await hashPassword(password);
    await this.users.save(account);
    await deleteUserPasswordResetTokens(account.id);

    logger.info(
      { guardianId, studentId, userId: account.id },
      "Guardian updated student password",
    );

    return {
      studentId: student.id,
      username: account.username,
    };
  }
}

export const guardianStudentsService = new GuardianStudentsService();
