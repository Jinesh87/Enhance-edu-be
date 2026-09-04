import { Between, ILike, In, LessThanOrEqual, MoreThanOrEqual } from "typeorm";
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
    subject?: string;
    yearGroup?: string;
    teacherId?: string;
    fromDate?: string;
    toDate?: string;
    kind?: "SCHOOL" | "ENTRANCE" | "ALL";
    status?: AssessmentStatus | "ACTIVE" | "OPEN";
    includeStudents?: boolean;
  }): Promise<{ assessments: Assessment[]; total: number }> {
    const where: Record<string, unknown> = {};
    if (filters.termId) where.termId = filters.termId;
    if (filters.subject) where.subject = filters.subject;
    if (filters.yearGroup) where.yearGroup = filters.yearGroup;
    if (filters.teacherId) where.teacherId = filters.teacherId;
    if (filters.kind && filters.kind !== "ALL") where.kind = filters.kind;
    if (filters.status === "ACTIVE") {
      where.status = In(["SCHEDULED", "LIVE"]);
    } else if (filters.status === "OPEN" || !filters.status) {
      where.status = In(["SCHEDULED", "LIVE", "COMPLETED"]);
    } else {
      where.status = filters.status;
    }
    if (filters.search) {
      where.name = ILike(`%${filters.search}%`);
    }
    if (filters.fromDate && filters.toDate) {
      where.assessmentDate = Between(filters.fromDate, filters.toDate);
    } else if (filters.fromDate) {
      where.assessmentDate = MoreThanOrEqual(filters.fromDate);
    } else if (filters.toDate) {
      where.assessmentDate = LessThanOrEqual(filters.toDate);
    }

    const includeStudents = filters.includeStudents !== false;

    const [assessments, total] = await this.assessments.findAndCount({
      where,
      relations: {
        linkedClass: true,
        term: { academicYear: true, yearLevel: true },
        classroom: true,
        teacher: true,
        ...(includeStudents ? { students: { student: true } } : {}),
      },
      order: { assessmentDate: "DESC", startTime: "ASC", createdAt: "DESC" },
      skip:
        filters.page && filters.limit
          ? (filters.page - 1) * filters.limit
          : undefined,
      take: filters.limit,
    });

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
        scheduleType: true,
      },
    });
  }

  create(data: Partial<Assessment>): Assessment {
    return this.assessments.create(data);
  }

  save(assessment: Assessment): Promise<Assessment> {
    return this.assessments.save(assessment);
  }

  async replaceStudents(assessmentId: string, studentIds: string[]) {
    await this.sitting.delete({ assessmentId });
    const uniqueIds = Array.from(new Set(studentIds));
    if (uniqueIds.length === 0) return;
    await this.sitting.save(
      uniqueIds.map((studentId) =>
        this.sitting.create({ assessmentId, studentId }),
      ),
    );
  }

  async findSittingStudentIds(assessmentId: string): Promise<string[]> {
    const rows = await this.sitting.find({
      where: { assessmentId },
      select: { studentId: true },
    });
    return rows.map((row) => row.studentId);
  }

  async deleteById(id: string): Promise<void> {
    await this.sitting.delete({ assessmentId: id });
    await this.assessments.delete({ id });
  }
}

export const adminAssessmentsRepository = new AdminAssessmentsRepository();
