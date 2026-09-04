import { In } from "typeorm";
import { AppDataSource } from "../../../config/data-source.js";
import {
  Assessment,
  type AssessmentStatus,
  AssessmentStudent,
} from "../../../entities/index.js";

export class AdminAssessmentsRepository {
  private readonly assessments = AppDataSource.getRepository(Assessment);
  private readonly sitting = AppDataSource.getRepository(AssessmentStudent);

  async list(filters: {
    page?: number;
    limit?: number;
    search?: string;
    termId?: string;
    term?: string;
    subject?: string;
    year?: number;
    yearGroup?: string;
    teacherId?: string;
    fromDate?: string;
    toDate?: string;
    kind?: "SCHOOL" | "ENTRANCE" | "ALL";
    status?: AssessmentStatus | "ACTIVE" | "OPEN";
    includeStudents?: boolean;
    summaryOnly?: boolean;
  }): Promise<{ assessments: Assessment[]; total: number }> {
    const summaryOnly = filters.summaryOnly === true;
    const includeStudents =
      !summaryOnly && filters.includeStudents !== false;

    const qb = this.assessments
      .createQueryBuilder("assessment")
      .leftJoinAndSelect("assessment.term", "term")
      .leftJoinAndSelect("term.academicYear", "academicYear")
      .leftJoinAndSelect("term.yearLevel", "yearLevel")
      .leftJoinAndSelect("assessment.classroom", "classroom")
      .leftJoinAndSelect("assessment.teacher", "teacher");

    if (!summaryOnly) {
      qb.leftJoinAndSelect("assessment.linkedClass", "linkedClass");
    }

    if (includeStudents) {
      qb.leftJoinAndSelect("assessment.students", "students").leftJoinAndSelect(
        "students.student",
        "student",
      );
    }

    if (filters.termId) {
      qb.andWhere("assessment.termId = :termId", { termId: filters.termId });
    }
    if (filters.term?.trim()) {
      qb.andWhere("LOWER(term.name) = LOWER(:termName)", {
        termName: filters.term.trim(),
      });
    }
    if (filters.subject) {
      qb.andWhere("assessment.subject = :subject", {
        subject: filters.subject,
      });
    }
    if (filters.year) {
      qb.andWhere("academicYear.year = :year", { year: filters.year });
    }
    if (filters.yearGroup?.trim()) {
      qb.andWhere("LOWER(assessment.yearGroup) = LOWER(:yearGroup)", {
        yearGroup: filters.yearGroup.trim(),
      });
    }
    if (filters.teacherId) {
      qb.andWhere("assessment.teacherId = :teacherId", {
        teacherId: filters.teacherId,
      });
    }
    if (filters.kind && filters.kind !== "ALL") {
      qb.andWhere("assessment.kind = :kind", { kind: filters.kind });
    }
    if (filters.status === "ACTIVE") {
      qb.andWhere("assessment.status IN (:...statuses)", {
        statuses: ["SCHEDULED", "LIVE"],
      });
    } else if (filters.status === "OPEN" || !filters.status) {
      qb.andWhere("assessment.status IN (:...statuses)", {
        statuses: ["SCHEDULED", "LIVE", "COMPLETED"],
      });
    } else {
      qb.andWhere("assessment.status = :status", { status: filters.status });
    }
    if (filters.search?.trim()) {
      qb.andWhere("assessment.name ILIKE :search", {
        search: `%${filters.search.trim()}%`,
      });
    }
    if (filters.fromDate && filters.toDate) {
      qb.andWhere("assessment.assessmentDate BETWEEN :fromDate AND :toDate", {
        fromDate: filters.fromDate,
        toDate: filters.toDate,
      });
    } else if (filters.fromDate) {
      qb.andWhere("assessment.assessmentDate >= :fromDate", {
        fromDate: filters.fromDate,
      });
    } else if (filters.toDate) {
      qb.andWhere("assessment.assessmentDate <= :toDate", {
        toDate: filters.toDate,
      });
    }

    qb.orderBy("assessment.assessmentDate", "DESC")
      .addOrderBy("assessment.startTime", "ASC")
      .addOrderBy("assessment.createdAt", "DESC");

    if (filters.page && filters.limit) {
      qb.skip((filters.page - 1) * filters.limit).take(filters.limit);
    } else if (filters.limit) {
      qb.take(filters.limit);
    }

    const [assessments, total] = await qb.getManyAndCount();

    if (summaryOnly && assessments.length > 0) {
      const ids = assessments.map((item) => item.id);
      const countRows = await this.sitting
        .createQueryBuilder("sitting")
        .select("sitting.assessmentId", "assessmentId")
        .addSelect("COUNT(*)", "cnt")
        .where("sitting.assessmentId IN (:...ids)", { ids })
        .groupBy("sitting.assessmentId")
        .getRawMany<{ assessmentId: string; cnt: string }>();

      const countById = new Map(
        countRows.map((row) => [row.assessmentId, Number(row.cnt) || 0]),
      );
      for (const assessment of assessments) {
        (assessment as Assessment & { studentCount?: number }).studentCount =
          countById.get(assessment.id) ?? 0;
      }
    }

    return { assessments, total };
  }

  findById(id: string): Promise<Assessment | null> {
    return this.assessments.findOne({
      where: { id },
      relations: {
        linkedClass: true,
        term: { academicYear: true, yearLevel: true },
        classroom: true,
        teacher: true,
        students: { student: true },
      },
    });
  }

  findByAssessmentDate(assessmentDate: string): Promise<Assessment[]> {
    return this.assessments.find({
      where: { assessmentDate },
    });
  }

  listScheduledForSync(): Promise<Assessment[]> {
    return this.assessments.find({
      where: { status: In(["SCHEDULED", "LIVE"]) },
      select: {
        id: true,
        assessmentDate: true,
        startTime: true,
        durationMinutes: true,
        status: true,
        timeZone: true,
        scheduleType: true,
      },
    });
  }

  create(data: Partial<Assessment>): Assessment {
    return this.assessments.create(data);
  }

  async save(assessment: Assessment): Promise<Assessment> {
    return this.assessments.save(assessment);
  }

  async findSittingStudentIds(assessmentId: string): Promise<string[]> {
    const rows = await this.sitting.find({
      where: { assessmentId },
      select: { studentId: true },
    });
    return rows.map((row) => row.studentId);
  }

  async replaceStudents(
    assessmentId: string,
    studentIds: string[],
  ): Promise<void> {
    await this.sitting.delete({ assessmentId });
    if (studentIds.length === 0) return;
    await this.sitting.save(
      studentIds.map((studentId) =>
        this.sitting.create({ assessmentId, studentId }),
      ),
    );
  }

  async deleteById(id: string): Promise<void> {
    await this.assessments.delete(id);
  }
}

export const adminAssessmentsRepository = new AdminAssessmentsRepository();
