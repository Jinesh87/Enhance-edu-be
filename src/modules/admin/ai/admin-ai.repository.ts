import { Between, In } from "typeorm";
import { AppDataSource } from "../../../config/data-source.js";
import {
  EnrollmentStatus,
  PendingEnrollmentStatus,
} from "../../../common/constants/enrollment.js";
import { UserRole, UserStatus } from "../../../common/constants/roles.js";
import { Assessment } from "../../../entities/Assessment.js";
import { AssessmentSubmission } from "../../../entities/AssessmentSubmission.js";
import { AttendanceRecord } from "../../../entities/AttendanceRecord.js";
import { AuditChange } from "../../../entities/AuditChange.js";
import { Class } from "../../../entities/Class.js";
import { Classroom } from "../../../entities/Classroom.js";
import { Enquiry } from "../../../entities/Enquiry.js";
import { Enrollment } from "../../../entities/Enrollment.js";
import { Holiday } from "../../../entities/Holiday.js";
import { Homework } from "../../../entities/Homework.js";
import { HomeworkStudent } from "../../../entities/HomeworkStudent.js";
import { HomeworkSubmission } from "../../../entities/HomeworkSubmission.js";
import { PendingEnrollment } from "../../../entities/PendingEnrollment.js";
import { Session } from "../../../entities/Session.js";
import { Subject } from "../../../entities/Subject.js";
import { Syllabus } from "../../../entities/Syllabus.js";
import { Task, TaskStatus } from "../../../entities/Task.js";
import { Term } from "../../../entities/Term.js";
import { User } from "../../../entities/User.js";

const MAX_ROWS = 40;
const LIST_MAX_ROWS = 60;

export type AttendanceStatusCountRow = { status: string; count: string };

export type LowAttendanceClassRow = {
  classId: string;
  className: string;
  subject: string | null;
  totalRecords: number;
  presentOrLate: number;
};

export type TeacherClassFilters = {
  subject?: string | null;
  teacherName?: string | null;
  yearLevel?: string | null;
  term?: string | null;
  academicYear?: string | null;
};

export type StudentEnrollmentFilters = {
  studentName?: string | null;
  subject?: string | null;
  yearLevel?: string | null;
  term?: string | null;
  academicYear?: string | null;
};

export type ClassSearchFilters = {
  subject?: string | null;
  className?: string | null;
  yearLevel?: string | null;
  term?: string | null;
  academicYear?: string | null;
  teacherName?: string | null;
};

export type TermScheduleFilters = {
  term?: string | null;
  yearLevel?: string | null;
  academicYear?: string | null;
};

export type EnrolmentSearchFilters = {
  studentName?: string | null;
  subject?: string | null;
  yearLevel?: string | null;
  term?: string | null;
  academicYear?: string | null;
};

export type EnquirySearchFilters = {
  studentName?: string | null;
  guardianName?: string | null;
  stage?: string | null;
  subject?: string | null;
  yearLevel?: string | null;
};

export type AssessmentSearchFilters = {
  subject?: string | null;
  yearLevel?: string | null;
  term?: string | null;
  status?: string | null;
  name?: string | null;
};

export type SessionListFilters = {
  yearLevel?: string | null;
  subject?: string | null;
};

export type PeopleSearchFilters = {
  name?: string | null;
  role?: UserRole | null;
  status?: UserStatus | null;
};

export type SyllabusSearchFilters = {
  subject?: string | null;
  yearLevel?: string | null;
  term?: string | null;
  academicYear?: string | null;
};

export type ChangeHistoryFilters = {
  recordType?: string | null;
  actorName?: string | null;
  action?: string | null;
  since: Date;
};

export type AcademicPerformanceRow = {
  assessmentTitle: string;
  markedCount: string;
  averageMark: string;
};

export type EnquiryPipelineRow = {
  stageName: string;
  stageCode: string;
  stageKind: string;
  count: string;
};

export type AbsenceRow = {
  studentName: string;
  status: string;
  className: string | null;
  subject: string | null;
  yearLevel: string | null;
  startAt: Date;
  timeZone: string | null;
};

export type ClassRosterRow = {
  className: string;
  subject: string | null;
  yearLevel: string | null;
  studentName: string;
};

export class AdminAiRepository {
  private readonly attendanceRecords =
    AppDataSource.getRepository(AttendanceRecord);
  private readonly sessions = AppDataSource.getRepository(Session);
  private readonly classes = AppDataSource.getRepository(Class);
  private readonly enrollments = AppDataSource.getRepository(Enrollment);
  private readonly pendingEnrollments =
    AppDataSource.getRepository(PendingEnrollment);
  private readonly subjects = AppDataSource.getRepository(Subject);
  private readonly terms = AppDataSource.getRepository(Term);
  private readonly enquiries = AppDataSource.getRepository(Enquiry);
  private readonly tasks = AppDataSource.getRepository(Task);
  private readonly assessments = AppDataSource.getRepository(Assessment);
  private readonly users = AppDataSource.getRepository(User);
  private readonly classrooms = AppDataSource.getRepository(Classroom);
  private readonly syllabi = AppDataSource.getRepository(Syllabus);
  private readonly auditChanges = AppDataSource.getRepository(AuditChange);
  private readonly homework = AppDataSource.getRepository(Homework);
  private readonly homeworkStudents =
    AppDataSource.getRepository(HomeworkStudent);
  private readonly homeworkSubmissions =
    AppDataSource.getRepository(HomeworkSubmission);
  private readonly assessmentSubmissions =
    AppDataSource.getRepository(AssessmentSubmission);
  private readonly holidays = AppDataSource.getRepository(Holiday);

  async getAttendanceStatusCounts(
    start: Date,
    endExclusive: Date,
  ): Promise<AttendanceStatusCountRow[]> {
    return this.attendanceRecords
      .createQueryBuilder("ar")
      .innerJoin("ar.session", "session")
      .select("ar.status", "status")
      .addSelect("COUNT(*)", "count")
      .where("session.startAt >= :start AND session.startAt < :end", {
        start,
        end: endExclusive,
      })
      .groupBy("ar.status")
      .getRawMany<AttendanceStatusCountRow>();
  }

  async getLowAttendanceClassAggregates(
    start: Date,
    endExclusive: Date,
    limit = MAX_ROWS,
  ): Promise<LowAttendanceClassRow[]> {
    const rows = await AppDataSource.query(
      `
    SELECT
      c.id AS "classId",
      c.name AS "className",
      c.subject AS subject,
      COUNT(ar.id)::int AS "totalRecords",
      COUNT(*) FILTER (
        WHERE ar.status IN ('PRESENT', 'LATE')
      )::int AS "presentOrLate"
    FROM attendance_records ar
    INNER JOIN sessions s ON s.id = ar."sessionId"
    INNER JOIN classes c ON c.id = s."classId"
    WHERE s."startAt" >= $1 AND s."startAt" < $2
      AND s."classId" IS NOT NULL
    GROUP BY c.id, c.name, c.subject
    HAVING COUNT(ar.id) > 0
    ORDER BY
      (COUNT(*) FILTER (WHERE ar.status IN ('PRESENT', 'LATE'))::float
        / NULLIF(COUNT(ar.id), 0)) ASC
    LIMIT $3
    `,
      [start, endExclusive, limit],
    );
    return rows as LowAttendanceClassRow[];
  }

  async findSessionsForDay(
    start: Date,
    end: Date,
    yearLevel: string | null,
    take = MAX_ROWS,
  ): Promise<Session[]> {
    const qb = this.sessions
      .createQueryBuilder("session")
      .leftJoinAndSelect("session.class", "class")
      .leftJoinAndSelect("class.term", "term")
      .leftJoinAndSelect("term.yearLevel", "yearLevel")
      .leftJoinAndSelect("term.academicYear", "academicYear")
      .leftJoinAndSelect("session.teacher", "sessionTeacher")
      .leftJoinAndSelect("class.teacher", "classTeacher")
      .leftJoinAndSelect("session.classroom", "classroom")
      .where("session.startAt >= :start AND session.startAt < :end", {
        start,
        end,
      })
      .andWhere("session.classId IS NOT NULL")
      .orderBy("session.startAt", "ASC")
      .take(take);

    if (yearLevel) {
      qb.andWhere(
        `(yearLevel.name ILIKE :yl OR CAST(yearLevel.sequence AS text) = :ylExact OR class.name ILIKE :yl)`,
        {
          yl: `%${yearLevel}%`,
          ylExact: yearLevel.replace(/[^0-9]/g, "") || yearLevel,
        },
      );
    }

    return qb.getMany();
  }

  async findClassesWithDayTime(
    filters: TermScheduleFilters,
    take = 200,
  ): Promise<Class[]> {
    const qb = this.classes
      .createQueryBuilder("class")
      .leftJoinAndSelect("class.term", "term")
      .leftJoinAndSelect("term.yearLevel", "yearLevel")
      .leftJoinAndSelect("term.academicYear", "academicYear")
      .leftJoinAndSelect("class.teacher", "teacher")
      .leftJoinAndSelect("class.classroom", "classroom")
      .where("class.dayTime IS NOT NULL")
      .orderBy("class.subject", "ASC")
      .take(take);

    if (filters.term) {
      qb.andWhere(`(term.name ILIKE :term OR class.termName ILIKE :term)`, {
        term: `%${filters.term}%`,
      });
    }

    if (filters.yearLevel) {
      qb.andWhere(
        `(yearLevel.name ILIKE :yl OR CAST(yearLevel.sequence AS text) = :ylExact OR class.name ILIKE :yl)`,
        {
          yl: `%${filters.yearLevel}%`,
          ylExact:
            filters.yearLevel.replace(/[^0-9]/g, "") || filters.yearLevel,
        },
      );
    }

    if (filters.academicYear) {
      qb.andWhere(
        `(CAST(academicYear.year AS text) ILIKE :ay OR academicYear.displayName ILIKE :ay)`,
        { ay: `%${filters.academicYear}%` },
      );
    }

    return qb.getMany();
  }

  async findTeacherClasses(filters: TeacherClassFilters): Promise<Class[]> {
    const qb = this.classes
      .createQueryBuilder("class")
      .leftJoinAndSelect("class.term", "term")
      .leftJoinAndSelect("term.yearLevel", "yearLevel")
      .leftJoinAndSelect("term.academicYear", "academicYear")
      .leftJoinAndSelect("class.teacher", "teacher")
      .orderBy("teacher.fullName", "ASC")
      .addOrderBy("class.subject", "ASC")
      .take(200);

    if (filters.subject) {
      qb.andWhere(
        `(class.subject ILIKE :subject OR class.name ILIKE :subject)`,
        { subject: `%${filters.subject}%` },
      );
    }
    if (filters.teacherName) {
      qb.andWhere(`teacher.fullName ILIKE :teacherName`, {
        teacherName: `%${filters.teacherName}%`,
      });
    }
    if (filters.yearLevel) {
      qb.andWhere(
        `(yearLevel.name ILIKE :yl OR CAST(yearLevel.sequence AS text) = :ylExact OR class.name ILIKE :yl)`,
        {
          yl: `%${filters.yearLevel}%`,
          ylExact:
            filters.yearLevel.replace(/[^0-9]/g, "") || filters.yearLevel,
        },
      );
    }
    if (filters.term) {
      qb.andWhere(`(term.name ILIKE :term OR class.termName ILIKE :term)`, {
        term: `%${filters.term}%`,
      });
    }
    if (filters.academicYear) {
      qb.andWhere(
        `(CAST(academicYear.year AS text) ILIKE :ay OR academicYear.displayName ILIKE :ay)`,
        { ay: `%${filters.academicYear}%` },
      );
    }

    return qb.getMany();
  }

  async findActiveEnrollmentsForStudentSearch(
    filters: StudentEnrollmentFilters,
  ): Promise<Enrollment[]> {
    const qb = this.enrollments
      .createQueryBuilder("enrollment")
      .leftJoinAndSelect("enrollment.student", "student")
      .leftJoinAndSelect("enrollment.term", "term")
      .leftJoinAndSelect("term.yearLevel", "yearLevel")
      .leftJoinAndSelect("term.academicYear", "academicYear")
      .leftJoinAndSelect("enrollment.subjects", "enrollmentSubjects")
      .leftJoinAndSelect("enrollmentSubjects.subject", "subjectEntity")
      .where("enrollment.status = :status", { status: EnrollmentStatus.ACTIVE })
      .orderBy("student.fullName", "ASC")
      .take(200);

    if (filters.studentName) {
      qb.andWhere(
        `(student.fullName ILIKE :studentName OR student.preferredName ILIKE :studentName)`,
        { studentName: `%${filters.studentName}%` },
      );
    }
    if (filters.yearLevel) {
      qb.andWhere(
        `(yearLevel.name ILIKE :yl OR CAST(yearLevel.sequence AS text) = :ylExact OR CAST(student.yearLevel AS text) = :ylExact)`,
        {
          yl: `%${filters.yearLevel}%`,
          ylExact:
            filters.yearLevel.replace(/[^0-9]/g, "") || filters.yearLevel,
        },
      );
    }
    if (filters.term) {
      qb.andWhere(`term.name ILIKE :term`, { term: `%${filters.term}%` });
    }
    if (filters.academicYear) {
      qb.andWhere(
        `(CAST(academicYear.year AS text) ILIKE :ay OR academicYear.displayName ILIKE :ay)`,
        { ay: `%${filters.academicYear}%` },
      );
    }
    if (filters.subject) {
      qb.andWhere(`subjectEntity.name ILIKE :subject`, {
        subject: `%${filters.subject}%`,
      });
    }

    return qb.getMany();
  }

  async findClassesForSearch(filters: ClassSearchFilters): Promise<Class[]> {
    const qb = this.classes
      .createQueryBuilder("class")
      .leftJoinAndSelect("class.term", "term")
      .leftJoinAndSelect("term.yearLevel", "yearLevel")
      .leftJoinAndSelect("term.academicYear", "academicYear")
      .leftJoinAndSelect("class.teacher", "teacher")
      .orderBy("class.subject", "ASC")
      .addOrderBy("class.name", "ASC")
      .take(200);

    if (filters.subject) {
      qb.andWhere(
        `(class.subject ILIKE :subject OR class.name ILIKE :subject)`,
        { subject: `%${filters.subject}%` },
      );
    }
    if (filters.className) {
      qb.andWhere(`class.name ILIKE :className`, {
        className: `%${filters.className}%`,
      });
    }
    if (filters.yearLevel) {
      qb.andWhere(
        `(yearLevel.name ILIKE :yl OR CAST(yearLevel.sequence AS text) = :ylExact OR class.name ILIKE :yl)`,
        {
          yl: `%${filters.yearLevel}%`,
          ylExact:
            filters.yearLevel.replace(/[^0-9]/g, "") || filters.yearLevel,
        },
      );
    }
    if (filters.term) {
      qb.andWhere(`(term.name ILIKE :term OR class.termName ILIKE :term)`, {
        term: `%${filters.term}%`,
      });
    }
    if (filters.academicYear) {
      qb.andWhere(
        `(CAST(academicYear.year AS text) ILIKE :ay OR academicYear.displayName ILIKE :ay)`,
        { ay: `%${filters.academicYear}%` },
      );
    }
    if (filters.teacherName) {
      qb.andWhere(`teacher.fullName ILIKE :teacherName`, {
        teacherName: `%${filters.teacherName}%`,
      });
    }

    return qb.getMany();
  }

  async findSubjects(filters: {
    yearLevel?: string | null;
    name?: string | null;
  }): Promise<Subject[]> {
    const qb = this.subjects
      .createQueryBuilder("subject")
      .leftJoinAndSelect("subject.yearLevel", "yearLevel")
      .orderBy("subject.name", "ASC")
      .take(LIST_MAX_ROWS);

    if (filters.name) {
      qb.andWhere(`subject.name ILIKE :name`, { name: `%${filters.name}%` });
    }
    if (filters.yearLevel) {
      qb.andWhere(
        `(yearLevel.name ILIKE :yl OR CAST(yearLevel.sequence AS text) = :ylExact)`,
        {
          yl: `%${filters.yearLevel}%`,
          ylExact:
            filters.yearLevel.replace(/[^0-9]/g, "") || filters.yearLevel,
        },
      );
    }

    return qb.getMany();
  }

  async findTerms(filters: {
    yearLevel?: string | null;
    term?: string | null;
    academicYear?: string | null;
  }): Promise<Term[]> {
    const qb = this.terms
      .createQueryBuilder("term")
      .leftJoinAndSelect("term.yearLevel", "yearLevel")
      .leftJoinAndSelect("term.academicYear", "academicYear")
      .orderBy("academicYear.year", "DESC")
      .addOrderBy("term.startDate", "ASC")
      .take(LIST_MAX_ROWS);

    if (filters.term) {
      qb.andWhere(`term.name ILIKE :term`, { term: `%${filters.term}%` });
    }
    if (filters.yearLevel) {
      qb.andWhere(
        `(yearLevel.name ILIKE :yl OR CAST(yearLevel.sequence AS text) = :ylExact)`,
        {
          yl: `%${filters.yearLevel}%`,
          ylExact:
            filters.yearLevel.replace(/[^0-9]/g, "") || filters.yearLevel,
        },
      );
    }
    if (filters.academicYear) {
      qb.andWhere(
        `(CAST(academicYear.year AS text) ILIKE :ay OR academicYear.displayName ILIKE :ay)`,
        { ay: `%${filters.academicYear}%` },
      );
    }

    return qb.getMany();
  }

  async findActiveEnrollmentsForEnrolmentSearch(
    filters: EnrolmentSearchFilters,
  ): Promise<Enrollment[]> {
    const qb = this.enrollments
      .createQueryBuilder("enrollment")
      .leftJoinAndSelect("enrollment.student", "student")
      .leftJoinAndSelect("enrollment.term", "term")
      .leftJoinAndSelect("term.yearLevel", "yearLevel")
      .leftJoinAndSelect("term.academicYear", "academicYear")
      .leftJoinAndSelect("enrollment.subjects", "enrollmentSubjects")
      .leftJoinAndSelect("enrollmentSubjects.subject", "subjectEntity")
      .where("enrollment.status = :status", { status: EnrollmentStatus.ACTIVE })
      .orderBy("student.fullName", "ASC")
      .take(200);

    if (filters.studentName) {
      qb.andWhere(
        `(student.fullName ILIKE :studentName OR student.preferredName ILIKE :studentName)`,
        { studentName: `%${filters.studentName}%` },
      );
    }
    if (filters.yearLevel) {
      qb.andWhere(
        `(yearLevel.name ILIKE :yl OR CAST(yearLevel.sequence AS text) = :ylExact)`,
        {
          yl: `%${filters.yearLevel}%`,
          ylExact:
            filters.yearLevel.replace(/[^0-9]/g, "") || filters.yearLevel,
        },
      );
    }
    if (filters.term) {
      qb.andWhere(`term.name ILIKE :term`, { term: `%${filters.term}%` });
    }
    if (filters.academicYear) {
      qb.andWhere(
        `(CAST(academicYear.year AS text) ILIKE :ay OR academicYear.displayName ILIKE :ay)`,
        { ay: `%${filters.academicYear}%` },
      );
    }
    if (filters.subject) {
      qb.andWhere(`subjectEntity.name ILIKE :subject`, {
        subject: `%${filters.subject}%`,
      });
    }

    return qb.getMany();
  }

  async findPendingEnrollmentsForEnrolmentSearch(
    filters: EnrolmentSearchFilters,
  ): Promise<PendingEnrollment[]> {
    const qb = this.pendingEnrollments
      .createQueryBuilder("pending")
      .leftJoinAndSelect("pending.term", "term")
      .leftJoinAndSelect("term.yearLevel", "yearLevel")
      .leftJoinAndSelect("term.academicYear", "academicYear")
      .leftJoinAndSelect("pending.subjects", "pendingSubjects")
      .leftJoinAndSelect("pendingSubjects.subject", "subjectEntity")
      .where("pending.status = :status", {
        status: PendingEnrollmentStatus.PENDING,
      })
      .orderBy("pending.studentFullName", "ASC")
      .take(200);

    if (filters.studentName) {
      qb.andWhere(
        `(pending.studentFullName ILIKE :studentName OR pending.studentPreferredName ILIKE :studentName)`,
        { studentName: `%${filters.studentName}%` },
      );
    }
    if (filters.yearLevel) {
      qb.andWhere(
        `(yearLevel.name ILIKE :yl OR CAST(yearLevel.sequence AS text) = :ylExact OR CAST(pending.studentYearLevel AS text) = :ylExact)`,
        {
          yl: `%${filters.yearLevel}%`,
          ylExact:
            filters.yearLevel.replace(/[^0-9]/g, "") || filters.yearLevel,
        },
      );
    }
    if (filters.term) {
      qb.andWhere(`term.name ILIKE :term`, { term: `%${filters.term}%` });
    }
    if (filters.academicYear) {
      qb.andWhere(
        `(CAST(academicYear.year AS text) ILIKE :ay OR academicYear.displayName ILIKE :ay)`,
        { ay: `%${filters.academicYear}%` },
      );
    }
    if (filters.subject) {
      qb.andWhere(`subjectEntity.name ILIKE :subject`, {
        subject: `%${filters.subject}%`,
      });
    }

    return qb.getMany();
  }

  async findEnquiries(filters: EnquirySearchFilters): Promise<Enquiry[]> {
    const qb = this.enquiries
      .createQueryBuilder("enquiry")
      .leftJoinAndSelect("enquiry.currentStage", "stage")
      .leftJoinAndSelect("enquiry.owner", "owner")
      .orderBy("enquiry.updatedAt", "DESC")
      .take(200);

    if (filters.studentName) {
      qb.andWhere(`enquiry.studentFullName ILIKE :studentName`, {
        studentName: `%${filters.studentName}%`,
      });
    }
    if (filters.guardianName) {
      qb.andWhere(`enquiry.guardianFullName ILIKE :guardianName`, {
        guardianName: `%${filters.guardianName}%`,
      });
    }
    if (filters.stage) {
      qb.andWhere(`(stage.name ILIKE :stage OR stage.code ILIKE :stage)`, {
        stage: `%${filters.stage}%`,
      });
    }
    if (filters.subject) {
      qb.andWhere(`enquiry.subjectOfInterest ILIKE :subject`, {
        subject: `%${filters.subject}%`,
      });
    }
    if (filters.yearLevel) {
      const exact = filters.yearLevel.replace(/[^0-9]/g, "") || filters.yearLevel;
      qb.andWhere(
        `(CAST(enquiry.yearLevel AS text) = :ylExact OR CAST(enquiry.yearLevel AS text) ILIKE :yl)`,
        { ylExact: exact, yl: `%${exact}%` },
      );
    }

    return qb.getMany();
  }

  async findTasks(filters: {
    status?: string | null;
    studentName?: string | null;
  }): Promise<Task[]> {
    const qb = this.tasks
      .createQueryBuilder("task")
      .leftJoinAndSelect("task.student", "student")
      .leftJoinAndSelect("task.session", "session")
      .leftJoinAndSelect("session.class", "class")
      .orderBy("task.dueAt", "ASC")
      .take(200);

    if (filters.status && filters.status !== "ALL") {
      qb.andWhere("task.status = :status", { status: filters.status });
    }
    if (filters.studentName) {
      qb.andWhere(`student.fullName ILIKE :studentName`, {
        studentName: `%${filters.studentName}%`,
      });
    }

    return qb.getMany();
  }

  async findAssessments(filters: AssessmentSearchFilters): Promise<Assessment[]> {
    const qb = this.assessments
      .createQueryBuilder("assessment")
      .leftJoinAndSelect("assessment.term", "term")
      .leftJoinAndSelect("term.yearLevel", "yearLevel")
      .leftJoinAndSelect("assessment.teacher", "teacher")
      .where("assessment.status NOT IN (:...excluded)", {
        excluded: ["ARCHIVED", "CANCELLED"],
      })
      .orderBy("assessment.assessmentDate", "ASC")
      .addOrderBy("assessment.startTime", "ASC")
      .take(200);

    if (filters.subject) {
      qb.andWhere(`assessment.subject ILIKE :subject`, {
        subject: `%${filters.subject}%`,
      });
    }
    if (filters.name) {
      qb.andWhere(`assessment.name ILIKE :name`, { name: `%${filters.name}%` });
    }
    if (filters.yearLevel) {
      qb.andWhere(
        `(assessment.yearGroup ILIKE :yl OR yearLevel.name ILIKE :yl OR CAST(yearLevel.sequence AS text) = :ylExact)`,
        {
          yl: `%${filters.yearLevel}%`,
          ylExact:
            filters.yearLevel.replace(/[^0-9]/g, "") || filters.yearLevel,
        },
      );
    }
    if (filters.term) {
      qb.andWhere(`term.name ILIKE :term`, { term: `%${filters.term}%` });
    }
    if (filters.status) {
      qb.andWhere(`assessment.status = :status`, { status: filters.status });
    }

    return qb.getMany();
  }

  async findSessionsInRange(
    start: Date,
    end: Date,
    filters: SessionListFilters,
  ): Promise<Session[]> {
    const qb = this.sessions
      .createQueryBuilder("session")
      .leftJoinAndSelect("session.class", "class")
      .leftJoinAndSelect("class.term", "term")
      .leftJoinAndSelect("term.yearLevel", "yearLevel")
      .leftJoinAndSelect("session.teacher", "sessionTeacher")
      .leftJoinAndSelect("class.teacher", "classTeacher")
      .leftJoinAndSelect("session.classroom", "classroom")
      .leftJoinAndSelect("session.assessment", "assessment")
      .where("session.startAt >= :start AND session.startAt < :end", {
        start,
        end,
      })
      .orderBy("session.startAt", "ASC")
      .take(200);

    if (filters.yearLevel) {
      qb.andWhere(
        `(yearLevel.name ILIKE :yl OR CAST(yearLevel.sequence AS text) = :ylExact OR class.name ILIKE :yl)`,
        {
          yl: `%${filters.yearLevel}%`,
          ylExact:
            filters.yearLevel.replace(/[^0-9]/g, "") || filters.yearLevel,
        },
      );
    }
    if (filters.subject) {
      qb.andWhere(
        `(class.subject ILIKE :subject OR class.name ILIKE :subject OR assessment.subject ILIKE :subject OR assessment.name ILIKE :subject)`,
        { subject: `%${filters.subject}%` },
      );
    }

    return qb.getMany();
  }

  async findPeople(filters: PeopleSearchFilters): Promise<User[]> {
    const qb = this.users
      .createQueryBuilder("user")
      .orderBy("user.fullName", "ASC")
      .take(200);

    if (filters.name) {
      qb.andWhere(
        `(user.fullName ILIKE :name OR user.preferredName ILIKE :name OR user.username ILIKE :name)`,
        { name: `%${filters.name}%` },
      );
    }
    if (filters.role) {
      qb.andWhere("user.role = :role", { role: filters.role });
    }
    if (filters.status) {
      qb.andWhere("user.status = :status", { status: filters.status });
    }

    return qb.getMany();
  }

  async findClassrooms(filters: {
    name?: string | null;
    activeOnly?: boolean;
  }): Promise<Classroom[]> {
    const qb = this.classrooms
      .createQueryBuilder("classroom")
      .orderBy("classroom.name", "ASC")
      .take(LIST_MAX_ROWS);

    if (filters.activeOnly !== false) {
      qb.andWhere("classroom.isActive = true");
    }
    if (filters.name) {
      qb.andWhere(
        `(classroom.name ILIKE :name OR classroom.code ILIKE :name)`,
        { name: `%${filters.name}%` },
      );
    }

    return qb.getMany();
  }

  async findSyllabi(filters: SyllabusSearchFilters): Promise<Syllabus[]> {
    const qb = this.syllabi
      .createQueryBuilder("syllabus")
      .leftJoinAndSelect("syllabus.subject", "subject")
      .leftJoinAndSelect("syllabus.yearLevel", "yearLevel")
      .leftJoinAndSelect("syllabus.term", "term")
      .leftJoinAndSelect("syllabus.academicYear", "academicYear")
      .orderBy("subject.name", "ASC")
      .addOrderBy("syllabus.title", "ASC")
      .take(200);

    if (filters.subject) {
      qb.andWhere(
        `(subject.name ILIKE :subject OR syllabus.title ILIKE :subject)`,
        { subject: `%${filters.subject}%` },
      );
    }
    if (filters.yearLevel) {
      qb.andWhere(
        `(yearLevel.name ILIKE :yl OR CAST(yearLevel.sequence AS text) = :ylExact)`,
        {
          yl: `%${filters.yearLevel}%`,
          ylExact:
            filters.yearLevel.replace(/[^0-9]/g, "") || filters.yearLevel,
        },
      );
    }
    if (filters.term) {
      qb.andWhere(`term.name ILIKE :term`, { term: `%${filters.term}%` });
    }
    if (filters.academicYear) {
      qb.andWhere(
        `(CAST(academicYear.year AS text) ILIKE :ay OR academicYear.displayName ILIKE :ay)`,
        { ay: `%${filters.academicYear}%` },
      );
    }

    return qb.getMany();
  }

  async findChangeHistory(filters: ChangeHistoryFilters): Promise<AuditChange[]> {
    const qb = this.auditChanges
      .createQueryBuilder("change")
      .where("change.createdAt >= :since", { since: filters.since })
      .orderBy("change.createdAt", "DESC")
      .take(200);

    if (filters.recordType) {
      qb.andWhere(
        `(change.recordType ILIKE :recordType OR change.recordLabel ILIKE :recordType)`,
        { recordType: `%${filters.recordType}%` },
      );
    }
    if (filters.actorName) {
      qb.andWhere(`change.actorName ILIKE :actorName`, {
        actorName: `%${filters.actorName}%`,
      });
    }
    if (filters.action) {
      qb.andWhere(`change.action = :action`, { action: filters.action });
    }

    return qb.getMany();
  }

  async findHomeworkInDateRange(
    startStr: string,
    endStr: string,
  ): Promise<Homework[]> {
    return this.homework.find({
      where: {
        dueDate: Between(startStr, endStr),
      },
      relations: { subject: true },
      take: MAX_ROWS,
      order: { dueDate: "ASC" },
    });
  }

  async countHomeworkStudents(homeworkIds: string[]): Promise<number> {
    if (homeworkIds.length === 0) return 0;
    return this.homeworkStudents.count({
      where: { homeworkId: In(homeworkIds) },
    });
  }

  async countHomeworkSubmissions(homeworkIds: string[]): Promise<number> {
    if (homeworkIds.length === 0) return 0;
    return this.homeworkSubmissions.count({
      where: { homeworkId: In(homeworkIds), status: "SUBMITTED" },
    });
  }

  async getAcademicPerformanceAggregates(
    subjectHint?: string | null,
  ): Promise<AcademicPerformanceRow[]> {
    const qb = this.assessmentSubmissions
      .createQueryBuilder("sub")
      .innerJoin(Assessment, "assessment", "assessment.id = sub.assessmentId")
      .select("assessment.title", "assessmentTitle")
      .addSelect("COUNT(sub.id)", "markedCount")
      .addSelect("AVG(sub.mark::float)", "averageMark")
      .where("sub.mark IS NOT NULL")
      .groupBy("assessment.id")
      .addGroupBy("assessment.title")
      .orderBy("AVG(sub.mark::float)", "ASC")
      .limit(20);

    if (subjectHint?.trim()) {
      qb.andWhere(
        `(assessment.title ILIKE :hint OR assessment.subject ILIKE :hint)`,
        { hint: `%${subjectHint.trim()}%` },
      );
    }

    return qb.getRawMany<AcademicPerformanceRow>();
  }

  async getEnquiryPipelineAggregates(): Promise<EnquiryPipelineRow[]> {
    return this.enquiries
      .createQueryBuilder("enquiry")
      .innerJoin("enquiry.currentStage", "stage")
      .select("stage.name", "stageName")
      .addSelect("stage.code", "stageCode")
      .addSelect("stage.kind", "stageKind")
      .addSelect("COUNT(enquiry.id)", "count")
      .groupBy("stage.id")
      .addGroupBy("stage.name")
      .addGroupBy("stage.code")
      .addGroupBy("stage.kind")
      .orderBy("stage.sortOrder", "ASC")
      .getRawMany<EnquiryPipelineRow>();
  }

  async countPendingEnrollments(): Promise<number> {
    return this.pendingEnrollments.count({
      where: { status: PendingEnrollmentStatus.PENDING },
    });
  }

  async countOpenTasks(): Promise<number> {
    return this.tasks.count({
      where: { status: TaskStatus.OPEN },
    });
  }

  async findTodaysAbsences(
    start: Date,
    end: Date,
    yearLevel: string | null,
  ): Promise<AbsenceRow[]> {
    const params: unknown[] = [start, end];
    let yearFilter = "";
    if (yearLevel) {
      params.push(`%${yearLevel}%`);
      params.push(yearLevel.replace(/[^0-9]/g, "") || yearLevel);
      yearFilter = `
      AND (
        yl.name ILIKE $3
        OR CAST(yl.sequence AS text) = $4
        OR c.name ILIKE $3
      )
    `;
    }

    const rows = await AppDataSource.query(
      `
    SELECT
      COALESCE(u."fullName", 'Unknown') AS "studentName",
      ar.status AS status,
      c.name AS "className",
      c.subject AS subject,
      yl.name AS "yearLevel",
      s."startAt" AS "startAt",
      c."timeZone" AS "timeZone"
    FROM attendance_records ar
    INNER JOIN sessions s ON s.id = ar."sessionId"
    LEFT JOIN users u ON u.id = ar."studentId"
    LEFT JOIN classes c ON c.id = s."classId"
    LEFT JOIN terms t ON t.id = c."termId"
    LEFT JOIN year_levels yl ON yl.id = t."yearLevelId"
    WHERE s."startAt" >= $1
      AND s."startAt" < $2
      AND ar.status IN ('ABSENT', 'EXCUSED', 'PENDING')
      ${yearFilter}
    ORDER BY s."startAt" ASC, u."fullName" ASC
    LIMIT 60
    `,
      params,
    );

    return rows as AbsenceRow[];
  }

  async findClassRosterRows(
    yearLevel: string | null,
    subjectOrClass: string | null,
  ): Promise<ClassRosterRow[]> {
    const params: unknown[] = [];
    const where: string[] = [];

    if (yearLevel) {
      params.push(`%${yearLevel}%`);
      const ylLike = params.length;
      params.push(yearLevel.replace(/[^0-9]/g, "") || yearLevel);
      const ylExact = params.length;
      where.push(
        `(yl.name ILIKE $${ylLike} OR CAST(yl.sequence AS text) = $${ylExact} OR c.name ILIKE $${ylLike})`,
      );
    }

    if (subjectOrClass) {
      params.push(`%${subjectOrClass}%`);
      const subjectIdx = params.length;
      where.push(
        `(c.subject ILIKE $${subjectIdx} OR c.name ILIKE $${subjectIdx} OR c.lesson ILIKE $${subjectIdx})`,
      );
    }

    if (where.length === 0) return [];

    const rows = await AppDataSource.query(
      `
    SELECT DISTINCT
      c.name AS "className",
      c.subject AS subject,
      yl.name AS "yearLevel",
      COALESCE(u."fullName", 'Unknown') AS "studentName"
    FROM class_students cs
    INNER JOIN classes c ON c.id = cs."classId"
    INNER JOIN users u ON u.id = cs."studentId"
    LEFT JOIN terms t ON t.id = c."termId"
    LEFT JOIN year_levels yl ON yl.id = t."yearLevelId"
    WHERE ${where.join(" AND ")}
    ORDER BY c.name ASC, u."fullName" ASC
    LIMIT 80
    `,
      params,
    );

    return rows as ClassRosterRow[];
  }

  async findTermsMatching(filters: {
    term?: string | null;
    yearLevel?: string | null;
    academicYear?: string | null;
  }): Promise<Term[]> {
    const qb = this.terms
      .createQueryBuilder("term")
      .leftJoinAndSelect("term.yearLevel", "yearLevel")
      .leftJoinAndSelect("term.academicYear", "academicYear");

    if (filters.term) {
      qb.andWhere("term.name ILIKE :term", { term: `%${filters.term}%` });
    }
    if (filters.yearLevel) {
      qb.andWhere(
        `(yearLevel.name ILIKE :yl OR CAST(yearLevel.sequence AS text) = :ylExact)`,
        {
          yl: `%${filters.yearLevel}%`,
          ylExact:
            filters.yearLevel.replace(/[^0-9]/g, "") || filters.yearLevel,
        },
      );
    }
    if (filters.academicYear) {
      qb.andWhere(
        `(CAST(academicYear.year AS text) ILIKE :ay OR academicYear.displayName ILIKE :ay)`,
        { ay: `%${filters.academicYear}%` },
      );
    }

    return qb.getMany();
  }

  async findAllHolidays(): Promise<Holiday[]> {
    return this.holidays.find({
      relations: {
        term: { academicYear: true, yearLevel: true },
      },
      order: { startDate: "ASC", name: "ASC" },
      take: 100,
    });
  }
}

export const adminAiRepository = new AdminAiRepository();
