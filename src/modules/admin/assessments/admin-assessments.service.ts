import { In } from "typeorm";
import { AppDataSource } from "../../../config/data-source.js";
import { EnrollmentStatus } from "../../../common/constants/enrollment.js";
import { UserRole } from "../../../common/constants/roles.js";
import { AppError } from "../../../common/errors/AppError.js";
import {
  DEFAULT_CLASS_TIMEZONE,
  zonedWallTimeToUtc,
} from "../../../common/utils/timezone.js";
import {
  Assessment,
  type AssessmentStatus,
  Class,
  ClassStudent,
  Classroom,
  Enrollment,
  Subject,
  Term,
  User,
} from "../../../entities/index.js";
import { adminAssessmentsRepository } from "./admin-assessments.repository.js";

export type AssessmentInput = {
  name: string;
  classId?: string | null;
  termId: string;
  subject: string;
  yearGroup: string;
  assessmentDate: string;
  startTime: string;
  durationMinutes: number;
  classroomId?: string | null;
  room?: string | null;
  teacherId?: string | null;
  notes?: string | null;
  studentIds?: string[];
};

export type AssessmentStudentDto = {
  id: string;
  fullName: string;
};

function termLabel(term: Term | null | undefined): string {
  return term?.name ?? "";
}

function classLabel(cls: Class | null | undefined): string {
  if (!cls) return "";
  const subject = cls.subject?.trim() || cls.name || "Class";
  return cls.code ? `${subject} · ${cls.code}` : subject;
}

function assessmentEndAt(
  assessmentDate: string,
  startTime: string,
  durationMinutes: number,
): Date | null {
  const dateParts = assessmentDate.split("-").map(Number);
  const timeParts = startTime.split(":").map(Number);
  if (dateParts.length < 3 || timeParts.length < 2) return null;
  const [year, month, day] = dateParts;
  const [hour, minute] = timeParts;
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    !Number.isFinite(durationMinutes)
  ) {
    return null;
  }
  const startAt = zonedWallTimeToUtc(
    { year, month, day, hour, minute, second: 0 },
    DEFAULT_CLASS_TIMEZONE,
  );
  if (Number.isNaN(startAt.getTime())) return null;
  return new Date(startAt.getTime() + durationMinutes * 60_000);
}

function hasAssessmentEnded(
  assessmentDate: string,
  startTime: string,
  durationMinutes: number,
  now = new Date(),
): boolean {
  const endAt = assessmentEndAt(assessmentDate, startTime, durationMinutes);
  if (!endAt) return false;
  return endAt.getTime() <= now.getTime();
}

function autoStatusForTiming(
  assessmentDate: string,
  startTime: string,
  durationMinutes: number,
): Extract<AssessmentStatus, "SCHEDULED" | "COMPLETED"> {
  return hasAssessmentEnded(assessmentDate, startTime, durationMinutes)
    ? "COMPLETED"
    : "SCHEDULED";
}

function toAssessmentDto(
  assessment: Assessment,
  includeStudents: boolean,
  enrolledStudents?: AssessmentStudentDto[],
) {
  const linkedStudents: AssessmentStudentDto[] = (assessment.students ?? [])
    .map((row) => row.student)
    .filter((student): student is User => Boolean(student))
    .map((student) => ({
      id: student.id,
      fullName: student.fullName,
    }));

  const students = (
    enrolledStudents && enrolledStudents.length > 0
      ? enrolledStudents
      : linkedStudents
  ).sort((left, right) => left.fullName.localeCompare(right.fullName));

  return {
    id: assessment.id,
    name: assessment.name,
    classId: assessment.classId,
    classLabel: classLabel(assessment.linkedClass),
    termId: assessment.termId,
    termLabel: termLabel(assessment.term),
    subject: assessment.subject,
    yearGroup: assessment.yearGroup,
    assessmentDate: assessment.assessmentDate,
    startTime: assessment.startTime,
    durationMinutes: assessment.durationMinutes,
    classroomId: assessment.classroomId,
    room: assessment.room || assessment.classroom?.name || "",
    teacherId: assessment.teacherId,
    teacherName: assessment.teacher?.fullName ?? null,
    notes: assessment.notes,
    status: assessment.status,
    studentCount: students.length,
    students: includeStudents ? students : undefined,
    createdAt: assessment.createdAt,
    updatedAt: assessment.updatedAt,
  };
}

export class AdminAssessmentsService {
  private readonly repo = adminAssessmentsRepository;
  private readonly classes = AppDataSource.getRepository(Class);
  private readonly terms = AppDataSource.getRepository(Term);
  private readonly classrooms = AppDataSource.getRepository(Classroom);
  private readonly users = AppDataSource.getRepository(User);
  private readonly classStudents = AppDataSource.getRepository(ClassStudent);
  private readonly enrollments = AppDataSource.getRepository(Enrollment);
  private readonly subjects = AppDataSource.getRepository(Subject);

  private async loadClass(classId: string | null | undefined) {
    if (!classId) return null;
    const cls = await this.classes.findOne({
      where: { id: classId },
      relations: {
        teacher: true,
        classroom: true,
        term: { academicYear: true, yearLevel: true },
      },
    });
    if (!cls) {
      throw new AppError(404, "Class not found", "CLASS_NOT_FOUND");
    }
    return cls;
  }

  private async loadTerm(termId: string) {
    const term = await this.terms.findOne({
      where: { id: termId },
      relations: { academicYear: true, yearLevel: true },
    });
    if (!term) {
      throw new AppError(404, "Term not found", "TERM_NOT_FOUND");
    }
    return term;
  }

  private async resolveClassroom(
    classroomId: string | null | undefined,
    room: string | null | undefined,
  ): Promise<{ classroomId: string | null; room: string }> {
    if (!classroomId) {
      return { classroomId: null, room: (room ?? "").trim() };
    }
    const classroom = await this.classrooms.findOne({
      where: { id: classroomId },
    });
    if (!classroom) {
      throw new AppError(404, "Classroom not found", "CLASSROOM_NOT_FOUND");
    }
    return { classroomId: classroom.id, room: classroom.name };
  }

  private async resolveTeacher(teacherId: string | null | undefined) {
    if (!teacherId) return null;
    const teacher = await this.users.findOne({ where: { id: teacherId } });
    if (!teacher) {
      throw new AppError(404, "Teacher not found", "TEACHER_NOT_FOUND");
    }
    return teacher.id;
  }

  private yearGroupNumber(yearGroup: string): number | null {
    const match = yearGroup.trim().match(/(\d+)/);
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
  }

  private async enrolledStudentsForSubject(
    subject: string,
    termId: string,
    yearGroup: string,
  ): Promise<AssessmentStudentDto[]> {
    const subjectKey = subject.trim().toLowerCase();
    const yearKey = yearGroup.trim().toLowerCase();
    if (!subjectKey || !termId) return [];

    const assessmentTerm = await this.terms.findOne({
      where: { id: termId },
      relations: { academicYear: true, yearLevel: true },
    });
    const academicYear = assessmentTerm?.academicYear?.year;

    // Same academic year + year group terms (e.g. Term 1/2/3 · 2026 · Year 1).
    // Enrollment may be on Term 2 while assessment is on Term 1.
    let relatedTermIds = [termId];
    if (academicYear != null) {
      const relatedTerms = await this.terms.find({
        where: { academicYear: { year: academicYear } },
        relations: { yearLevel: true },
      });
      relatedTermIds = relatedTerms
        .filter((term) => {
          const level = (term.yearLevel?.name ?? "").trim().toLowerCase();
          return !yearKey || !level || level === yearKey;
        })
        .map((term) => term.id);
      if (relatedTermIds.length === 0) relatedTermIds = [termId];
    }

    const subjectRows = await this.subjects.find({
      relations: { yearLevel: true },
    });
    const matchingSubjectIds = subjectRows
      .filter((row) => {
        if (row.name.trim().toLowerCase() !== subjectKey) return false;
        const level = (row.yearLevel?.name ?? "").trim().toLowerCase();
        return !yearKey || !level || level === yearKey;
      })
      .map((row) => row.id);

    const byId = new Map<string, AssessmentStudentDto>();
    const yearNum = this.yearGroupNumber(yearGroup);

    if (matchingSubjectIds.length > 0) {
      const enrollments = await this.enrollments.find({
        where: {
          termId: In(relatedTermIds),
          status: In([
            EnrollmentStatus.ACTIVE,
            EnrollmentStatus.AWAITING_GUARDIAN,
          ]),
        },
        relations: { student: true, subjects: true },
      });
      for (const enrollment of enrollments) {
        const hasSubject = (enrollment.subjects ?? []).some((row) =>
          matchingSubjectIds.includes(row.subjectId),
        );
        if (!hasSubject || !enrollment.student) continue;
        if (
          yearNum != null &&
          enrollment.student.yearLevel != null &&
          enrollment.student.yearLevel !== yearNum
        ) {
          continue;
        }
        const id = enrollment.student.userId ?? enrollment.student.id;
        byId.set(id, {
          id,
          fullName: enrollment.student.fullName,
        });
      }
    }

    // Fallback: timetable class_students for matching subject classes.
    const classes = await this.classes.find({
      where: { term: { id: In(relatedTermIds) } },
      relations: { term: { yearLevel: true } },
    });
    const matchingClassIds = classes
      .filter((cls) => {
        if ((cls.subject ?? "").trim().toLowerCase() !== subjectKey) {
          return false;
        }
        const level = (cls.term?.yearLevel?.name ?? "").trim().toLowerCase();
        return !yearKey || !level || level === yearKey;
      })
      .map((cls) => cls.id);

    if (matchingClassIds.length > 0) {
      const rows = await this.classStudents.find({
        where: { classId: In(matchingClassIds) },
        relations: { student: true },
      });
      for (const row of rows) {
        if (!row.student) continue;
        byId.set(row.student.id, {
          id: row.student.id,
          fullName: row.student.fullName,
        });
      }
    }

    return Array.from(byId.values()).sort((left, right) =>
      left.fullName.localeCompare(right.fullName),
    );
  }

  private async enrolledUserIdsForSubject(
    subject: string,
    termId: string,
    yearGroup: string,
  ): Promise<string[]> {
    const enrolled = await this.enrolledStudentsForSubject(
      subject,
      termId,
      yearGroup,
    );
    const candidateIds = enrolled.map((student) => student.id);
    if (candidateIds.length === 0) return [];
    const users = await this.users.find({
      where: { id: In(candidateIds), role: UserRole.STUDENT },
      select: { id: true },
    });
    return users.map((user) => user.id);
  }

  private async validateStudentIds(studentIds: string[]): Promise<string[]> {
    const uniqueIds = Array.from(new Set(studentIds));
    if (uniqueIds.length === 0) return [];
    const found = await this.users.find({
      where: { id: In(uniqueIds), role: UserRole.STUDENT },
      select: { id: true },
    });
    if (found.length !== uniqueIds.length) {
      throw new AppError(
        400,
        "One or more selected students were not found",
        "STUDENT_NOT_FOUND",
      );
    }
    return uniqueIds;
  }

  private async resolveStudentIds(
    classId: string | null,
    studentIds: string[] | undefined,
    existing?: string[],
    subjectContext?: {
      subject: string;
      termId: string;
      yearGroup: string;
    },
  ): Promise<string[]> {
    if (studentIds !== undefined && studentIds.length > 0) {
      return this.validateStudentIds(studentIds);
    }
    if (classId) {
      const rows = await this.classStudents.find({
        where: { classId },
        select: { studentId: true },
      });
      return rows.map((row) => row.studentId);
    }
    if (subjectContext) {
      return this.enrolledUserIdsForSubject(
        subjectContext.subject,
        subjectContext.termId,
        subjectContext.yearGroup,
      );
    }
    return existing ?? [];
  }

  private async enrichDto(assessment: Assessment, includeStudents: boolean) {
    const enrolled = await this.enrolledStudentsForSubject(
      assessment.subject,
      assessment.termId,
      assessment.yearGroup,
    );
    return toAssessmentDto(assessment, includeStudents, enrolled);
  }

  private async ensureAutoStatus(assessment: Assessment): Promise<Assessment> {
    if (assessment.status !== "SCHEDULED") return assessment;
    if (
      !hasAssessmentEnded(
        assessment.assessmentDate,
        assessment.startTime,
        assessment.durationMinutes,
      )
    ) {
      return assessment;
    }
    assessment.status = "COMPLETED";
    return this.repo.save(assessment);
  }

  private async syncPastScheduled(): Promise<void> {
    const scheduled = await this.repo.listScheduledForSync();
    for (const assessment of scheduled) {
      await this.ensureAutoStatus(assessment);
    }
  }

  async list(filters: {
    page?: number;
    limit?: number;
    search?: string;
    termId?: string;
    subject?: string;
    yearGroup?: string;
    status?: AssessmentStatus | "ACTIVE";
  }) {
    await this.syncPastScheduled();
    const { assessments, total } = await this.repo.list(filters);
    const enriched = await Promise.all(
      assessments.map((item) => this.enrichDto(item, true)),
    );
    return { assessments: enriched, total };
  }

  async getById(id: string) {
    const assessment = await this.repo.findById(id);
    if (!assessment) {
      throw new AppError(404, "Assessment not found", "ASSESSMENT_NOT_FOUND");
    }
    const synced = await this.ensureAutoStatus(assessment);
    return this.enrichDto(synced, true);
  }

  async create(input: AssessmentInput) {
    const cls = await this.loadClass(input.classId ?? null);
    const term = await this.loadTerm(input.termId);
    const classroom = await this.resolveClassroom(
      input.classroomId ?? cls?.classroomId ?? cls?.classroom?.id,
      input.room ?? cls?.room,
    );
    const teacherId = await this.resolveTeacher(
      input.teacherId ?? cls?.teacher?.id ?? null,
    );
    const yearGroup = input.yearGroup.trim() || term.yearLevel?.name || "";
    if (!yearGroup) {
      throw new AppError(400, "Year group is required", "YEAR_GROUP_REQUIRED");
    }
    const studentIds = await this.resolveStudentIds(
      cls?.id ?? null,
      input.studentIds,
      undefined,
      {
        subject: input.subject.trim(),
        termId: term.id,
        yearGroup,
      },
    );

    const created = this.repo.create({
      name: input.name.trim(),
      classId: cls?.id ?? null,
      termId: term.id,
      subject: input.subject.trim(),
      yearGroup,
      assessmentDate: input.assessmentDate,
      startTime: input.startTime,
      durationMinutes: input.durationMinutes,
      classroomId: classroom.classroomId,
      room: classroom.room,
      teacherId,
      notes: input.notes?.trim() || null,
      status: autoStatusForTiming(
        input.assessmentDate,
        input.startTime,
        input.durationMinutes,
      ),
    });
    const saved = await this.repo.save(created);
    await this.repo.replaceStudents(saved.id, studentIds);
    return this.getById(saved.id);
  }

  async update(id: string, input: Partial<AssessmentInput>) {
    const assessment = await this.repo.findById(id);
    if (!assessment) {
      throw new AppError(404, "Assessment not found", "ASSESSMENT_NOT_FOUND");
    }
    if (assessment.status === "ARCHIVED") {
      throw new AppError(
        400,
        "Archived assessments cannot be edited",
        "ASSESSMENT_ARCHIVED",
      );
    }

    const nextClassId =
      input.classId === undefined ? assessment.classId : input.classId || null;
    const cls = await this.loadClass(nextClassId);
    const term = await this.loadTerm(input.termId ?? assessment.termId);
    const classroom = await this.resolveClassroom(
      input.classroomId === undefined
        ? assessment.classroomId
        : input.classroomId,
      input.room === undefined ? assessment.room : input.room,
    );
    const teacherId = await this.resolveTeacher(
      input.teacherId === undefined ? assessment.teacherId : input.teacherId,
    );
    const existingStudentIds = await this.repo.findSittingStudentIds(id);
    assessment.name = input.name?.trim() ?? assessment.name;
    assessment.classId = cls?.id ?? null;
    assessment.termId = term.id;
    assessment.subject = input.subject?.trim() ?? assessment.subject;
    assessment.yearGroup = input.yearGroup?.trim() || assessment.yearGroup;
    assessment.assessmentDate =
      input.assessmentDate ?? assessment.assessmentDate;
    assessment.startTime = input.startTime ?? assessment.startTime;
    assessment.durationMinutes =
      input.durationMinutes ?? assessment.durationMinutes;
    assessment.classroomId = classroom.classroomId;
    assessment.room = classroom.room;
    assessment.teacherId = teacherId;
    if (input.notes !== undefined) {
      assessment.notes = input.notes?.trim() || null;
    }
    assessment.status = autoStatusForTiming(
      assessment.assessmentDate,
      assessment.startTime,
      assessment.durationMinutes,
    );

    const studentIds = await this.resolveStudentIds(
      cls?.id ?? null,
      input.studentIds,
      existingStudentIds,
      {
        subject: assessment.subject,
        termId: assessment.termId,
        yearGroup: assessment.yearGroup,
      },
    );

    await this.repo.save(assessment);
    await this.repo.replaceStudents(id, studentIds);
    return this.getById(id);
  }

  async archive(id: string) {
    const assessment = await this.repo.findById(id);
    if (!assessment) {
      throw new AppError(404, "Assessment not found", "ASSESSMENT_NOT_FOUND");
    }
    assessment.status = "ARCHIVED";
    await this.repo.save(assessment);
    return this.enrichDto(assessment, false);
  }

  async remove(id: string) {
    const assessment = await this.repo.findById(id);
    if (!assessment) {
      throw new AppError(404, "Assessment not found", "ASSESSMENT_NOT_FOUND");
    }
    await this.repo.deleteById(id);
  }
}

export const adminAssessmentsService = new AdminAssessmentsService();
