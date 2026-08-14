import { In } from "typeorm";
import { AppDataSource } from "../../../config/data-source.js";
import { Enrollment, GuardianStudent, User } from "../../../entities/index.js";

function toStudentDto(
  link: GuardianStudent,
  enrollments: Enrollment[],
  account: User | null,
) {
  const student = link.student;
  return {
    id: student.id,
    fullName: student.fullName,
    preferredName: student.preferredName,
    dateOfBirth: student.dateOfBirth,
    yearLevel: student.yearLevel,
    username: account?.username ?? null,
    enrollments: enrollments.map((enrollment) => ({
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
    })),
  };
}

export class GuardianStudentsService {
  private readonly links = AppDataSource.getRepository(GuardianStudent);
  private readonly enrollments = AppDataSource.getRepository(Enrollment);
  private readonly users = AppDataSource.getRepository(User);

  async listForGuardian(guardianId: string) {
    const links = await this.links.find({
      where: { guardianId },
      relations: { student: true },
      order: { createdAt: "DESC" },
    });

    if (links.length === 0) return [];

    const studentIds = links.map((link) => link.studentId);
    const userIds = links
      .map((link) => link.student.userId)
      .filter((id): id is string => Boolean(id));

    const [enrollmentRows, accounts] = await Promise.all([
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
    ]);

    const accountsById = new Map(accounts.map((user) => [user.id, user]));
    const enrollmentsByStudent = new Map<string, Enrollment[]>();
    for (const enrollment of enrollmentRows) {
      const current = enrollmentsByStudent.get(enrollment.studentId) ?? [];
      current.push(enrollment);
      enrollmentsByStudent.set(enrollment.studentId, current);
    }

    return links.map((link) =>
      toStudentDto(
        link,
        enrollmentsByStudent.get(link.studentId) ?? [],
        link.student.userId
          ? accountsById.get(link.student.userId) ?? null
          : null,
      ),
    );
  }
}

export const guardianStudentsService = new GuardianStudentsService();
