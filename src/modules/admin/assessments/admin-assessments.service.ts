import { In } from "typeorm";
import { AppDataSource } from "../../../config/data-source.js";
import { EnrollmentStatus } from "../../../common/constants/enrollment.js";
import { UserRole } from "../../../common/constants/roles.js";
import { AppError } from "../../../common/errors/AppError.js";
import {
  DEFAULT_CLASS_TIMEZONE,
  parseDayTime,
  resolveIanaTimeZone,
} from "../../../common/utils/timezone.js";
import { getObjectBuffer } from "../../../common/storage/object-storage.js";
import {
  Assessment,
  AssessmentSubmission,
  AssessmentSubmissionFile,
  type AssessmentStatus,
  Class,
  ClassStudent,
  Classroom,
  Enrollment,
  Subject,
  Term,
  Session,
  User,
  type AssessmentScheduleType,
} from "../../../entities/index.js";
import { adminAssessmentsRepository } from "./admin-assessments.repository.js";
import {
  assessmentScheduleWindow,
  assessmentSessionSyncService,
} from "./assessment-session-sync.service.js";

export type AssessmentInput = {
  name: string;
  kind?: "SCHOOL" | "ENTRANCE";
  scheduleType?: AssessmentScheduleType;
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
  totalMarks?: number | null;
  cutOffMarks?: number | null;
  autoMarking?: boolean;
  notes?: string | null;
  studentIds?: string[];
  timeZone?: string | null;
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

function marksNumber(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function marksColumn(value: number | null | undefined): string | null {
  if (value == null) return null;
  return String(value);
}

function autoStatusForTiming(
  assessmentDate: string,
  startTime: string,
  durationMinutes: number,
  scheduleType: AssessmentScheduleType = "SESSION",
  timeZone?: string | null,
): Extract<AssessmentStatus, "SCHEDULED" | "LIVE" | "COMPLETED"> {
  const window = assessmentScheduleWindow(
    assessmentDate,
    startTime,
    durationMinutes,
    scheduleType,
    timeZone,
  );
  if (!window) return "SCHEDULED";
  const now = Date.now();
  if (now >= window.endAt.getTime()) return "COMPLETED";
  if (now >= window.startAt.getTime()) return "LIVE";
  return "SCHEDULED";
}

type ScheduleResource = {
  termId: string | null;
  teacherId: string | null;
  classroomId: string | null;
  classId: string | null;
  room: string | null;
  subject: string | null;
  yearGroup: string | null;
};

type ScheduleCandidate = ScheduleResource & {
  label: string;
  startAt: Date;
  endAt: Date;
};

function sameText(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const normalizedLeft = left?.trim().toLowerCase();
  const normalizedRight = right?.trim().toLowerCase();
  return Boolean(normalizedLeft && normalizedRight) && normalizedLeft === normalizedRight;
}

function sharedScheduleResource(
  proposed: ScheduleResource,
  existing: ScheduleResource,
): string | null {
  if (proposed.teacherId && proposed.teacherId === existing.teacherId) {
    return "the same teacher";
  }
  if (
    proposed.classroomId &&
    proposed.classroomId === existing.classroomId
  ) {
    return "the same classroom";
  }
  if (proposed.classId && proposed.classId === existing.classId) {
    return "the same class";
  }
  if (
    proposed.termId &&
    proposed.termId === existing.termId &&
    sameText(proposed.yearGroup, existing.yearGroup)
  ) {
    return "the same class cohort";
  }
  if (
    sameText(proposed.subject, existing.subject) &&
    sameText(proposed.yearGroup, existing.yearGroup)
  ) {
    return "the same subject and year-group cohort";
  }
  if (
    !proposed.classroomId &&
    !existing.classroomId &&
    sameText(proposed.room, existing.room)
  ) {
    return "the same room";
  }
  return null;
}

function overlaps(
  proposedStart: Date,
  proposedEnd: Date,
  existingStart: Date,
  existingEnd: Date,
): boolean {
  return (
    proposedStart.getTime() < existingEnd.getTime() &&
    existingStart.getTime() < proposedEnd.getTime()
  );
}

function scheduleConflictError(
  candidate: ScheduleCandidate,
  existing: ScheduleCandidate,
  resource: string,
): AppError {
  const field =
    resource === "the same teacher"
      ? "teacherId"
      : resource === "the same classroom" || resource === "the same room"
        ? "classroomId"
        : "startTime";
  const time = existing.startAt.toLocaleTimeString("en-AU", {
    timeZone: DEFAULT_CLASS_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
  });
  return new AppError(
    409,
    `Assessment "${candidate.label}" overlaps ${existing.label} at ${time} because it uses ${resource}.`,
    "ASSESSMENT_TIME_CONFLICT",
    {
      field,
      conflictSubject: existing.subject?.trim() || existing.label,
    },
  );
}

function addDaysToIsoDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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
    kind: assessment.kind ?? "SCHOOL",
    scheduleType: assessment.scheduleType ?? "SESSION",
    classId: assessment.classId,
    classLabel: classLabel(assessment.linkedClass),
    termId: assessment.termId,
    termLabel: termLabel(assessment.term),
    isTrialTerm: Boolean(assessment.term?.isTrial),
    subject: assessment.subject,
    yearGroup: assessment.yearGroup,
    assessmentDate: assessment.assessmentDate,
    startTime: assessment.startTime,
    durationMinutes: assessment.durationMinutes,
    timeZone: assessment.timeZone ?? DEFAULT_CLASS_TIMEZONE,
    classroomId: assessment.classroomId,
    room: assessment.room || assessment.classroom?.name || "",
    teacherId: assessment.teacherId,
    teacherName: assessment.teacher?.fullName ?? null,
    totalMarks: marksNumber(assessment.totalMarks),
    cutOffMarks: marksNumber(assessment.cutOffMarks),
    autoMarking: Boolean(assessment.autoMarking),
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
  private readonly sessions = AppDataSource.getRepository(Session);
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

  private async assertAssessmentDateWithinTerm(
    assessmentDate: string,
    term: Term,
  ): Promise<void> {
    if (assessmentDate < term.startDate) {
      throw new AppError(
        400,
        "Assessment date cannot be earlier than term start date",
        "ASSESSMENT_DATE_OUTSIDE_TERM",
        { field: "assessmentDate" },
      );
    }

    const allTerms = await this.terms.find({
      relations: { academicYear: true, yearLevel: true },
    });

    const termYear = term.academicYear?.year;
    const termLevel = (term.yearLevel?.name ?? "").trim().toLowerCase();

    const futureTerms = allTerms
      .filter((other) => {
        if (other.id === term.id || other.isTrial) return false;
        if (!other.startDate) return false;
        const otherLevel = (other.yearLevel?.name ?? "").trim().toLowerCase();
        // Same year level only — next term may be in a later academic year.
        if (termLevel && otherLevel && otherLevel !== termLevel) return false;
        return other.startDate > term.startDate;
      })
      .sort((a, b) => a.startDate.localeCompare(b.startDate));

    const maxDate =
      futureTerms.length > 0
        ? addDaysToIsoDate(futureTerms[0].startDate, -1)
        : termYear
          ? `${termYear}-12-31`
          : term.endDate;

    const allowedEnd = maxDate > term.endDate ? maxDate : term.endDate;

    if (assessmentDate > allowedEnd) {
      throw new AppError(
        400,
        "Assessment date is outside the term assessment period",
        "ASSESSMENT_DATE_OUTSIDE_TERM",
        { field: "assessmentDate" },
      );
    }
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

  private assertEntranceRequirements(input: {
    teacherId: string | null;
    totalMarks: number | null;
    cutOffMarks: number | null;
  }) {
    if (!input.teacherId) {
      throw new AppError(
        400,
        "Teacher is required for entrance exams",
        "TEACHER_REQUIRED",
      );
    }
    if (input.totalMarks == null) {
      throw new AppError(
        400,
        "Total marks are required for entrance exams",
        "TOTAL_MARKS_REQUIRED",
      );
    }
    if (input.cutOffMarks == null) {
      throw new AppError(
        400,
        "Cut-off marks are required for entrance exams",
        "CUT_OFF_MARKS_REQUIRED",
      );
    }
    if (input.cutOffMarks > input.totalMarks) {
      throw new AppError(
        400,
        "Cut-off marks cannot exceed total marks",
        "CUT_OFF_EXCEEDS_TOTAL",
      );
    }
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
    if (!includeStudents) {
      return toAssessmentDto(assessment, false, []);
    }
    const enrolled = await this.enrolledStudentsForSubject(
      assessment.subject,
      assessment.termId,
      assessment.yearGroup,
    );
    return toAssessmentDto(assessment, true, enrolled);
  }

  private async ensureAutoStatus(assessment: Assessment): Promise<Assessment> {
    if (
      assessment.status === "ARCHIVED" ||
      assessment.status === "CANCELLED"
    ) {
      return assessment;
    }
    const nextStatus = autoStatusForTiming(
      assessment.assessmentDate,
      assessment.startTime,
      assessment.durationMinutes,
      assessment.scheduleType,
      assessment.timeZone,
    );
    if (assessment.status === nextStatus) return assessment;
    assessment.status = nextStatus;
    return this.repo.save(assessment);
  }

  async syncAssessmentStatuses(): Promise<void> {
    const rows = await AppDataSource.getRepository(Assessment).find({
      where: { status: In(["SCHEDULED", "LIVE", "COMPLETED"]) },
      select: {
        id: true,
        assessmentDate: true,
        startTime: true,
        durationMinutes: true,
        scheduleType: true,
        timeZone: true,
        status: true,
      },
    });
    for (const assessment of rows) {
      const nextStatus = autoStatusForTiming(
        assessment.assessmentDate,
        assessment.startTime,
        assessment.durationMinutes,
        assessment.scheduleType,
        assessment.timeZone,
      );
      if (assessment.status === nextStatus) continue;
      assessment.status = nextStatus;
      await this.repo.save(assessment);
    }
  }

  private async syncPastScheduled(): Promise<void> {
    await this.syncAssessmentStatuses();
  }

  private async assertScheduleAvailable(
    input: {
      termId: string;
      scheduleType: AssessmentScheduleType;
      assessmentDate: string;
      startTime: string;
      durationMinutes: number;
      teacherId: string | null;
      classroomId: string | null;
      classId: string | null;
      room: string | null;
      subject: string;
      yearGroup: string;
      timeZone?: string | null;
    },
    excludeAssessmentId?: string,
  ): Promise<void> {
    const window = assessmentScheduleWindow(
      input.assessmentDate,
      input.startTime,
      input.durationMinutes,
      input.scheduleType,
      input.timeZone,
    );
    if (!window) {
      throw new AppError(
        400,
        "Assessment date and time are invalid",
        "ASSESSMENT_SCHEDULE_INVALID",
      );
    }

    const proposed: ScheduleCandidate = {
      ...input,
      termId: input.termId,
      label: `assessment "${input.subject}"`,
      startAt: window.startAt,
      endAt: window.endAt,
    };

    const assessments = await this.repo.findByAssessmentDate(
      input.assessmentDate,
    );
    for (const assessment of assessments) {
      if (
        assessment.id === excludeAssessmentId ||
        assessment.status === "ARCHIVED" ||
        assessment.status === "CANCELLED"
      ) {
        continue;
      }
      const existingWindow = assessmentScheduleWindow(
        assessment.assessmentDate,
        assessment.startTime,
        assessment.durationMinutes,
        assessment.scheduleType,
        assessment.timeZone,
      );
      if (
        !existingWindow ||
        !overlaps(
          proposed.startAt,
          proposed.endAt,
          existingWindow.startAt,
          existingWindow.endAt,
        )
      ) {
        continue;
      }

      const existing: ScheduleCandidate = {
        termId: assessment.termId,
        label: `assessment "${assessment.name}"`,
        startAt: existingWindow.startAt,
        endAt: existingWindow.endAt,
        teacherId: assessment.teacherId,
        classroomId: assessment.classroomId,
        classId: assessment.classId,
        room: assessment.room,
        subject: assessment.subject,
        yearGroup: assessment.yearGroup,
      };
      const resource = sharedScheduleResource(proposed, existing);
      if (resource) throw scheduleConflictError(proposed, existing, resource);
    }

    const sessions = await this.sessions
      .createQueryBuilder("session")
      .leftJoinAndSelect("session.class", "class")
      .leftJoinAndSelect("class.teacher", "classTeacher")
      .leftJoinAndSelect("class.term", "classTerm")
      .leftJoinAndSelect("classTerm.yearLevel", "classYearLevel")
      .where("session.assessmentId IS NULL")
      .andWhere("session.startAt < :endAt", { endAt: proposed.endAt })
      .andWhere("session.endAt > :startAt", { startAt: proposed.startAt })
      .getMany();

    for (const session of sessions) {
      const existingClass = session.class;
      const currentClassWindow = existingClass?.dayTime
        ? parseDayTime(existingClass.dayTime, existingClass.timeZone)
        : null;
      if (
        !currentClassWindow ||
        currentClassWindow.startAt.getTime() !== session.startAt.getTime() ||
        currentClassWindow.endAt.getTime() !== session.endAt.getTime()
      ) {
        continue;
      }
      const existing: ScheduleCandidate = {
        termId: existingClass?.term?.id ?? null,
        label: `normal session "${existingClass?.subject || existingClass?.name || "class"}"`,
        startAt: session.startAt,
        endAt: session.endAt,
        teacherId: existingClass?.teacher?.id ?? session.teacherId ?? null,
        classroomId: existingClass?.classroomId ?? session.classroomId ?? null,
        classId: session.classId,
        room: existingClass?.room ?? session.room ?? null,
        subject: existingClass?.subject ?? null,
        yearGroup: existingClass?.term?.yearLevel?.name ?? null,
      };
      if (input.scheduleType === "FULL_DAY") continue;
      const resource = sharedScheduleResource(proposed, existing);
      if (resource) throw scheduleConflictError(proposed, existing, resource);
    }
  }

  async list(filters: {
    page?: number;
    limit?: number;
    search?: string;
    termId?: string;
    subject?: string;
    yearGroup?: string;
    teacherId?: string;
    fromDate?: string;
    toDate?: string;
    kind?: "SCHOOL" | "ENTRANCE" | "ALL";
    status?: AssessmentStatus | "ACTIVE" | "OPEN";
    includeStudents?: boolean;
  }) {
    const includeStudents = filters.includeStudents !== false;
    if (includeStudents) {
      await this.syncPastScheduled();
    }
    const { assessments, total } = await this.repo.list(filters);
    const enriched = await Promise.all(
      assessments.map((item) => this.enrichDto(item, includeStudents)),
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
    await this.assertAssessmentDateWithinTerm(input.assessmentDate, term);
    const kind = input.kind === "ENTRANCE" ? "ENTRANCE" : "SCHOOL";
    const scheduleType = input.scheduleType ?? "SESSION";
    if (scheduleType === "FULL_DAY" && kind !== "SCHOOL") {
      throw new AppError(
        400,
        "Full-day scheduling is only available for school assessments",
        "FULL_DAY_SCHOOL_ONLY",
      );
    }
    const startTime = scheduleType === "FULL_DAY" ? "00:00" : input.startTime;
    const durationMinutes =
      scheduleType === "FULL_DAY" ? 1440 : input.durationMinutes;
    if (kind === "ENTRANCE" && !term.isTrial) {
      throw new AppError(
        400,
        "Entrance exams must use a trial term",
        "TRIAL_TERM_REQUIRED",
      );
    }
    const classroom = await this.resolveClassroom(
      input.classroomId ?? cls?.classroomId ?? cls?.classroom?.id,
      input.room ?? cls?.room,
    );
    const teacherId = await this.resolveTeacher(
      input.teacherId ?? cls?.teacher?.id ?? null,
    );
    const totalMarks = marksNumber(input.totalMarks);
    const cutOffMarks = marksNumber(input.cutOffMarks);
    const autoMarking = Boolean(input.autoMarking);

    if (kind === "ENTRANCE") {
      this.assertEntranceRequirements({
        teacherId,
        totalMarks,
        cutOffMarks,
      });
    } else if (totalMarks != null && cutOffMarks != null && cutOffMarks > totalMarks) {
      throw new AppError(
        400,
        "Pass mark cannot exceed total marks",
        "PASS_MARK_EXCEEDS_TOTAL",
        { field: "cutOffMarks" },
      );
    }
    const yearGroup = input.yearGroup.trim() || term.yearLevel?.name || "";
    if (!yearGroup) {
      throw new AppError(400, "Year group is required", "YEAR_GROUP_REQUIRED");
    }
    const timeZone = resolveIanaTimeZone(
      input.timeZone ?? DEFAULT_CLASS_TIMEZONE,
    );
    await this.assertScheduleAvailable({
      termId: term.id,
      scheduleType,
      assessmentDate: input.assessmentDate,
      startTime,
      durationMinutes,
      teacherId,
      classroomId: classroom.classroomId,
      classId: kind === "ENTRANCE" ? null : cls?.id ?? null,
      room: classroom.room,
      subject: input.subject.trim(),
      yearGroup,
      timeZone,
    });
    const studentIds =
      kind === "ENTRANCE"
        ? []
        : await this.resolveStudentIds(
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
      kind,
      scheduleType,
      classId: kind === "ENTRANCE" ? null : cls?.id ?? null,
      termId: term.id,
      subject: input.subject.trim(),
      yearGroup,
      assessmentDate: input.assessmentDate,
      startTime,
      durationMinutes,
      timeZone,
      classroomId: classroom.classroomId,
      room: classroom.room,
      teacherId,
      totalMarks: marksColumn(totalMarks),
      cutOffMarks: marksColumn(cutOffMarks),
      autoMarking,
      notes: input.notes?.trim() || null,
      status: autoStatusForTiming(
        input.assessmentDate,
        startTime,
        durationMinutes,
        scheduleType,
        timeZone,
      ),
    });
    const saved = await this.repo.save(created);
    await this.repo.replaceStudents(saved.id, studentIds);
    await assessmentSessionSyncService.syncFromAssessment(saved.id);
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
    if (input.kind === "ENTRANCE" || assessment.kind === "ENTRANCE") {
      const nextKind = input.kind ?? assessment.kind;
      if (nextKind === "ENTRANCE" && !term.isTrial) {
        throw new AppError(
          400,
          "Entrance exams must use a trial term",
          "TRIAL_TERM_REQUIRED",
        );
      }
    }
    const classroom = await this.resolveClassroom(
      input.classroomId === undefined
        ? assessment.classroomId
        : input.classroomId,
      input.room === undefined ? assessment.room : input.room,
    );
    const teacherId = await this.resolveTeacher(
      input.teacherId === undefined ? assessment.teacherId : input.teacherId,
    );
    const nextKind = input.kind ?? assessment.kind;
    const nextScheduleType =
      input.scheduleType ?? assessment.scheduleType ?? "SESSION";
    if (nextScheduleType === "FULL_DAY" && nextKind !== "SCHOOL") {
      throw new AppError(
        400,
        "Full-day scheduling is only available for school assessments",
        "FULL_DAY_SCHOOL_ONLY",
      );
    }
    const nextSubject = input.subject?.trim() ?? assessment.subject;
    const nextYearGroup =
      input.yearGroup?.trim() || assessment.yearGroup;
    const nextAssessmentDate =
      input.assessmentDate ?? assessment.assessmentDate;
    const nextStartTime =
      nextScheduleType === "FULL_DAY"
        ? "00:00"
        : input.startTime ??
          (assessment.scheduleType === "FULL_DAY"
            ? "09:00"
            : assessment.startTime);
    const nextDurationMinutes =
      nextScheduleType === "FULL_DAY"
        ? 1440
        : input.durationMinutes ??
          (assessment.scheduleType === "FULL_DAY"
            ? 60
            : assessment.durationMinutes);
    await this.assertAssessmentDateWithinTerm(nextAssessmentDate, term);
    const nextTimeZone =
      input.timeZone === undefined
        ? assessment.timeZone
        : resolveIanaTimeZone(input.timeZone);
    await this.assertScheduleAvailable(
      {
        termId: term.id,
        scheduleType: nextScheduleType,
        assessmentDate: nextAssessmentDate,
        startTime: nextStartTime,
        durationMinutes: nextDurationMinutes,
        teacherId,
        classroomId: classroom.classroomId,
        classId: nextKind === "ENTRANCE" ? null : cls?.id ?? null,
        room: classroom.room,
        subject: nextSubject,
        yearGroup: nextYearGroup,
        timeZone: nextTimeZone,
      },
      id,
    );
    const existingStudentIds = await this.repo.findSittingStudentIds(id);
    assessment.name = input.name?.trim() ?? assessment.name;
    assessment.kind = nextKind;
    assessment.scheduleType = nextScheduleType;
    assessment.classId =
      assessment.kind === "ENTRANCE" ? null : cls?.id ?? null;
    assessment.termId = term.id;
    assessment.subject = nextSubject;
    assessment.yearGroup = nextYearGroup;
    assessment.assessmentDate = nextAssessmentDate;
    assessment.startTime = nextStartTime;
    assessment.durationMinutes = nextDurationMinutes;
    assessment.timeZone = nextTimeZone;
    assessment.classroomId = classroom.classroomId;
    assessment.room = classroom.room;
    assessment.teacherId = teacherId;
    const totalMarks =
      input.totalMarks === undefined
        ? marksNumber(assessment.totalMarks)
        : marksNumber(input.totalMarks);
    const cutOffMarks =
      input.cutOffMarks === undefined
        ? marksNumber(assessment.cutOffMarks)
        : marksNumber(input.cutOffMarks);

    if (assessment.kind === "ENTRANCE") {
      this.assertEntranceRequirements({
        teacherId,
        totalMarks,
        cutOffMarks,
      });
    } else if (totalMarks != null && cutOffMarks != null && cutOffMarks > totalMarks) {
      throw new AppError(
        400,
        "Pass mark cannot exceed total marks",
        "PASS_MARK_EXCEEDS_TOTAL",
        { field: "cutOffMarks" },
      );
    }
    assessment.totalMarks = marksColumn(totalMarks);
    assessment.cutOffMarks = marksColumn(cutOffMarks);

    if (input.autoMarking !== undefined) {
      assessment.autoMarking = Boolean(input.autoMarking);
    }

    if (input.notes !== undefined) {
      assessment.notes = input.notes?.trim() || null;
    }
    assessment.status = autoStatusForTiming(
      assessment.assessmentDate,
      assessment.startTime,
      assessment.durationMinutes,
      assessment.scheduleType,
      assessment.timeZone,
    );

    const studentIds =
      assessment.kind === "ENTRANCE"
        ? []
        : await this.resolveStudentIds(
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
    await assessmentSessionSyncService.syncFromAssessment(id);
    return this.getById(id);
  }

  async archive(id: string) {
    const assessment = await this.repo.findById(id);
    if (!assessment) {
      throw new AppError(404, "Assessment not found", "ASSESSMENT_NOT_FOUND");
    }
    assessment.status = "ARCHIVED";
    await this.repo.save(assessment);
    await assessmentSessionSyncService.syncFromAssessment(id);
    return this.enrichDto(assessment, false);
  }

  async remove(id: string) {
    const assessment = await this.repo.findById(id);
    if (!assessment) {
      throw new AppError(404, "Assessment not found", "ASSESSMENT_NOT_FOUND");
    }
    // Session.assessmentId has ON DELETE CASCADE; delete assessment sitting+row.
    await this.repo.deleteById(id);
  }

  /**
   * Entrance exams assigned to this teacher that have at least one submitted
   * attempt. Sorted with unfinished marking first.
   */
  async listMarkingQueue(teacherId: string) {
    const assessments = await AppDataSource.getRepository(Assessment).find({
      where: {
        teacherId,
        kind: "ENTRANCE",
        status: In(["SCHEDULED", "COMPLETED"]),
      },
      relations: { term: { academicYear: true, yearLevel: true } },
      order: { assessmentDate: "DESC", startTime: "ASC" },
    });

    if (assessments.length === 0) {
      return { items: [], needsMarking: 0 };
    }

    const submissions = await AppDataSource.getRepository(
      AssessmentSubmission,
    ).find({
      where: {
        assessmentId: In(assessments.map((row) => row.id)),
        status: In(["SUBMITTED", "PROCESSING", "READY", "FAILED"]),
      },
      select: {
        id: true,
        assessmentId: true,
        mark: true,
      },
    });

    const byAssessment = new Map<
      string,
      { submitted: number; unmarked: number }
    >();
    for (const row of submissions) {
      const current = byAssessment.get(row.assessmentId) ?? {
        submitted: 0,
        unmarked: 0,
      };
      current.submitted += 1;
      if (marksNumber(row.mark) == null) current.unmarked += 1;
      byAssessment.set(row.assessmentId, current);
    }

    const items = assessments
      .map((assessment) => {
        const counts = byAssessment.get(assessment.id) ?? {
          submitted: 0,
          unmarked: 0,
        };
        return {
          id: assessment.id,
          name: assessment.name,
          subject: assessment.subject,
          yearGroup: assessment.yearGroup,
          termLabel: termLabel(assessment.term),
          assessmentDate: assessment.assessmentDate,
          startTime: assessment.startTime,
          status: assessment.status,
          totalMarks: marksNumber(assessment.totalMarks),
          cutOffMarks: marksNumber(assessment.cutOffMarks),
          submittedCount: counts.submitted,
          unmarkedCount: counts.unmarked,
        };
      })
      .filter((item) => item.submittedCount > 0)
      .sort((a, b) => {
        if (a.unmarkedCount !== b.unmarkedCount) {
          return b.unmarkedCount - a.unmarkedCount;
        }
        return b.assessmentDate.localeCompare(a.assessmentDate);
      });

    const needsMarking = items.reduce(
      (sum, item) => sum + item.unmarkedCount,
      0,
    );

    return { items, needsMarking };
  }

  async listAttendees(assessmentId: string) {
    const assessment = await this.repo.findById(assessmentId);
    if (!assessment) {
      throw new AppError(404, "Assessment not found", "ASSESSMENT_NOT_FOUND");
    }

    const submissions = await AppDataSource.getRepository(
      AssessmentSubmission,
    ).find({
      where: {
        assessmentId,
        status: In(["SUBMITTED", "PROCESSING", "READY", "FAILED"]),
      },
      relations: { student: true, files: true },
      order: { submittedAt: "DESC", createdAt: "DESC" },
    });

    const attendees = submissions
      .filter((row) => row.student)
      .map((row) => ({
        studentId: row.studentId,
        fullName: row.student.fullName,
        preferredName: row.student.preferredName,
        submissionId: row.id,
        status: row.status,
        submittedAt: row.submittedAt?.toISOString() ?? null,
        fileCount: row.files?.length ?? 0,
        hasExtractedText: Boolean(row.extractedText?.trim()),
        ocrError: row.ocrError,
        mark: marksNumber(row.mark),
        markedAt: row.markedAt?.toISOString() ?? null,
      }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));

    return {
      assessment: {
        id: assessment.id,
        name: assessment.name,
        kind: assessment.kind ?? "SCHOOL",
        subject: assessment.subject,
        yearGroup: assessment.yearGroup,
        termLabel: termLabel(assessment.term),
        assessmentDate: assessment.assessmentDate,
        totalMarks: marksNumber(assessment.totalMarks),
        cutOffMarks: marksNumber(assessment.cutOffMarks),
        teacherId: assessment.teacherId,
      },
      attendees,
    };
  }

  async getAttendeeSubmission(assessmentId: string, studentId: string) {
    const assessment = await this.repo.findById(assessmentId);
    if (!assessment) {
      throw new AppError(404, "Assessment not found", "ASSESSMENT_NOT_FOUND");
    }

    const submission = await AppDataSource.getRepository(
      AssessmentSubmission,
    ).findOne({
      where: { assessmentId, studentId },
      relations: { student: true, files: true, markedBy: true },
    });

    if (!submission || submission.status === "DRAFT") {
      throw new AppError(
        404,
        "No submitted answers found for this student",
        "SUBMISSION_NOT_FOUND",
      );
    }

    const files = (submission.files ?? [])
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((file) => ({
        id: file.id,
        originalName: file.originalName,
        mimeType: file.mimeType,
        byteSize: file.byteSize,
        sortOrder: file.sortOrder,
        extractedText: file.extractedText,
        kind: file.mimeType.startsWith("image/")
          ? ("image" as const)
          : file.mimeType === "application/pdf"
            ? ("pdf" as const)
            : ("other" as const),
      }));

    const totalMarks = marksNumber(assessment.totalMarks);
    const cutOffMarks = marksNumber(assessment.cutOffMarks);
    const mark = marksNumber(submission.mark);

    return {
      assessment: {
        id: assessment.id,
        name: assessment.name,
        subject: assessment.subject,
        kind: assessment.kind ?? "SCHOOL",
        totalMarks,
        cutOffMarks,
        teacherId: assessment.teacherId,
      },
      student: {
        id: submission.studentId,
        fullName: submission.student?.fullName ?? "Student",
        preferredName: submission.student?.preferredName ?? null,
      },
      submission: {
        id: submission.id,
        status: submission.status,
        submittedAt: submission.submittedAt?.toISOString() ?? null,
        extractedText: submission.extractedText,
        ocrError: submission.ocrError,
        mark,
        markedAt: submission.markedAt?.toISOString() ?? null,
        markedById: submission.markedById,
        markedByName: submission.markedBy?.fullName ?? null,
        markNotes: submission.markNotes,
        outcome:
          mark != null && cutOffMarks != null
            ? mark >= cutOffMarks
              ? ("PASS" as const)
              : mark >= cutOffMarks * 0.9
                ? ("BORDERLINE" as const)
                : ("FAIL" as const)
            : null,
        files,
      },
    };
  }

  async assertCanAccessAttendees(
    assessmentId: string,
    actor: { id: string; role: string },
  ) {
    const assessment = await this.repo.findById(assessmentId);
    if (!assessment) {
      throw new AppError(404, "Assessment not found", "ASSESSMENT_NOT_FOUND");
    }
    if (
      actor.role === UserRole.SUPER_ADMIN ||
      actor.role === UserRole.OFFICE_STAFF
    ) {
      return assessment;
    }
    if (
      actor.role === UserRole.STAFF &&
      assessment.teacherId &&
      assessment.teacherId === actor.id
    ) {
      return assessment;
    }
    throw new AppError(
      403,
      "You can only mark assessments assigned to you",
      "FORBIDDEN",
    );
  }

  async markAttendeeSubmission(
    assessmentId: string,
    studentId: string,
    input: { mark: number; markNotes?: string | null },
    actor: { id: string; role: string; fullName?: string | null },
  ) {
    await this.assertCanAccessAttendees(assessmentId, actor);
    const assessment = await this.repo.findById(assessmentId);
    if (!assessment) {
      throw new AppError(404, "Assessment not found", "ASSESSMENT_NOT_FOUND");
    }

    const submission = await AppDataSource.getRepository(
      AssessmentSubmission,
    ).findOne({
      where: { assessmentId, studentId },
      relations: { student: true },
    });
    if (!submission || submission.status === "DRAFT") {
      throw new AppError(
        404,
        "No submitted answers found for this student",
        "SUBMISSION_NOT_FOUND",
      );
    }

    const mark = marksNumber(input.mark);
    if (mark == null || mark < 0) {
      throw new AppError(400, "Mark is required", "MARK_REQUIRED");
    }
    const totalMarks = marksNumber(assessment.totalMarks);
    if (totalMarks != null && mark > totalMarks) {
      throw new AppError(
        400,
        `Mark cannot exceed total marks (${totalMarks})`,
        "MARK_EXCEEDS_TOTAL",
      );
    }

    submission.mark = marksColumn(mark);
    submission.markedAt = new Date();
    submission.markedById = actor.id;
    submission.markNotes = input.markNotes?.trim() || null;
    await AppDataSource.getRepository(AssessmentSubmission).save(submission);

    if (assessment.kind === "ENTRANCE") {
      const cutOff = marksNumber(assessment.cutOffMarks);
      if (cutOff != null) {
        try {
          const actorUser = await this.users.findOne({
            where: { id: actor.id },
          });
          const { adminEnquiriesService } = await import(
            "../enquiries/admin-enquiries.service.js"
          );
          await adminEnquiriesService.recordExamFromAssessmentMark(
            studentId,
            {
              termId: assessment.termId,
              examSession: assessment.name,
              examMark: mark,
              examThreshold: cutOff,
              examMarkedBy:
                actor.fullName?.trim() ||
                actorUser?.fullName?.trim() ||
                "Teacher",
              examScriptReference: `assessment:${assessment.id}/student:${studentId}`,
            },
            actor.id,
          );
        } catch (error) {
          const { logger } = await import("../../../config/logger.js");
          logger.error(
            { error, assessmentId, studentId },
            "Failed to sync assessment mark onto enquiry",
          );
        }
      }
    }

    return this.getAttendeeSubmission(assessmentId, studentId);
  }

  async getAttendeeFile(
    assessmentId: string,
    studentId: string,
    fileId: string,
  ): Promise<{ buffer: Buffer; mimeType: string; originalName: string }> {
    const file = await AppDataSource.getRepository(
      AssessmentSubmissionFile,
    ).findOne({
      where: { id: fileId },
      relations: { submission: true },
    });

    if (
      !file ||
      !file.submission ||
      file.submission.assessmentId !== assessmentId ||
      file.submission.studentId !== studentId
    ) {
      throw new AppError(404, "File not found", "FILE_NOT_FOUND");
    }

    if (file.submission.status === "DRAFT") {
      throw new AppError(404, "File not found", "FILE_NOT_FOUND");
    }

    try {
      const buffer = await getObjectBuffer(file.storageKey);
      return {
        buffer,
        mimeType: file.mimeType,
        originalName: file.originalName,
      };
    } catch {
      throw new AppError(404, "Stored file is missing", "FILE_MISSING");
    }
  }
}

export const adminAssessmentsService = new AdminAssessmentsService();