import { ILike } from "typeorm";
import { AppDataSource } from "../../../config/data-source.js";
import { AppError } from "../../../common/errors/AppError.js";
import {
  AcademicYear,
  Class,
  Classroom,
  Session,
  Term,
  YearLevel,
} from "../../../entities/index.js";

type TermInput = {
  name: string;
  academicYear: number;
  yearLevel: string;
  classroomId?: string | null;
  startDate: string;
  endDate: string;
  isTrial?: boolean;
};

function datesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
) {
  return aStart <= bEnd && bStart <= aEnd;
}

function toTermDto(term: Term) {
  return {
    id: term.id,
    name: term.name,
    academicYear: term.academicYear
      ? {
          id: term.academicYear.id,
          year: term.academicYear.year,
          displayName: term.academicYear.displayName,
        }
      : undefined,
    yearLevel: term.yearLevel
      ? {
          id: term.yearLevel.id,
          name: term.yearLevel.name,
          sequence: term.yearLevel.sequence,
        }
      : undefined,
    classroomId: term.classroomId ?? term.classroom?.id ?? null,
    classroom: term.classroom
      ? {
          id: term.classroom.id,
          name: term.classroom.name,
          code: term.classroom.code,
        }
      : null,
    startDate: term.startDate,
    endDate: term.endDate,
    isTrial: Boolean(term.isTrial),
    createdAt: term.createdAt,
    updatedAt: term.updatedAt,
  };
}

export class AdminTermsService {
  private readonly terms = AppDataSource.getRepository(Term);
  private readonly academicYears = AppDataSource.getRepository(AcademicYear);
  private readonly yearLevels = AppDataSource.getRepository(YearLevel);
  private readonly classrooms = AppDataSource.getRepository(Classroom);
  private readonly classes = AppDataSource.getRepository(Class);
  private readonly sessions = AppDataSource.getRepository(Session);

  async list(filters?: {
    page?: number;
    limit?: number;
    yearLevel?: string;
    year?: number;
    search?: string;
  }) {
    const findOptions: {
      relations: { academicYear: true; yearLevel: true; classroom: true };
      order: { startDate: "DESC" };
      where: Record<string, unknown>;
      skip?: number;
      take?: number;
    } = {
      relations: { academicYear: true, yearLevel: true, classroom: true },
      order: { startDate: "DESC" },
      where: {},
    };
    if (filters?.yearLevel) {
      findOptions.where.yearLevel = { name: filters.yearLevel };
    }
    if (filters?.year) {
      findOptions.where.academicYear = { year: filters.year };
    }
    if (filters?.search) {
      findOptions.where.name = ILike(`%${filters.search}%`);
    }
    if (filters?.page && filters?.limit) {
      findOptions.skip = (filters.page - 1) * filters.limit;
      findOptions.take = filters.limit;
    }
    const [terms, total] = await this.terms.findAndCount(findOptions);
    return {
      terms: terms.map(toTermDto),
      total,
    };
  }

  async create(input: TermInput) {
    const payload = await this.prepareTerm(input);

    await this.assertTermUnique(
      payload.name,
      payload.academicYear.id,
      payload.yearLevel.id,
    );

    const term = this.terms.create({
      name: payload.name,
      startDate: payload.startDate,
      endDate: payload.endDate,
      isTrial: payload.isTrial,
      academicYear: payload.academicYear,
      yearLevel: payload.yearLevel,
      classroomId: payload.classroom?.id ?? null,
      classroom: payload.classroom,
    });
    await this.terms.save(term);
    return toTermDto(await this.findTermOrThrow(term.id));
  }

  async update(id: string, input: TermInput) {
    const term = await this.findTermOrThrow(id);
    const payload = await this.prepareTerm(input, id);

    await this.assertTermUnique(
      payload.name,
      payload.academicYear.id,
      payload.yearLevel.id,
      id,
    );

    term.name = payload.name;
    term.startDate = payload.startDate;
    term.endDate = payload.endDate;
    term.isTrial = payload.isTrial;
    term.academicYear = payload.academicYear;
    term.yearLevel = payload.yearLevel;
    term.classroomId = payload.classroom?.id ?? null;
    term.classroom = payload.classroom;
    await this.terms.save(term);
    await this.syncClassesForTerm(term);
    return toTermDto(await this.findTermOrThrow(term.id));
  }

  async remove(id: string) {
    const term = await this.findTermOrThrow(id);
    await this.terms.remove(term);
  }

  private async prepareTerm(input: TermInput, excludeTermId?: string) {
    const name = input.name.trim();
    const startDate = input.startDate.trim();
    const endDate = input.endDate.trim();
    const academicYearValue = input.academicYear;
    const yearLevelName = input.yearLevel.trim();
    const isTrial = Boolean(input.isTrial);

    if (!name) {
      throw new AppError(400, "Term name is required", "VALIDATION_ERROR");
    }

    if (!academicYearValue) {
      throw new AppError(400, "Academic year is required", "VALIDATION_ERROR");
    }

    if (!yearLevelName) {
      throw new AppError(
        400,
        "Level of study is required",
        "VALIDATION_ERROR",
      );
    }

    if (endDate < startDate) {
      throw new AppError(
        400,
        "End date must be on or after the start date",
        "VALIDATION_ERROR",
      );
    }

    let academicYear = await this.academicYears.findOneBy({
      year: academicYearValue,
    });
    if (!academicYear) {
      academicYear = this.academicYears.create({
        year: academicYearValue,
        displayName: `${academicYearValue}`,
      });
      await this.academicYears.save(academicYear);
    }

    let yearLevel = await this.yearLevels.findOneBy({ name: yearLevelName });
    if (!yearLevel) {
      const match = yearLevelName.match(/\d+/);
      const seq = match ? parseInt(match[0], 10) : 0;
      yearLevel = this.yearLevels.create({
        name: yearLevelName,
        sequence: seq,
      });
      await this.yearLevels.save(yearLevel);
    }

    const classroom = await this.resolveClassroom(input.classroomId);
    if (classroom) {
      await this.assertClassroomFree(classroom.id, startDate, endDate, {
        excludeIds: excludeTermId ? [excludeTermId] : [],
        academicYearId: academicYear.id,
        yearLevelId: yearLevel.id,
      });
    }

    return {
      name,
      startDate,
      endDate,
      isTrial,
      academicYear,
      yearLevel,
      classroom,
    };
  }

  private async resolveClassroom(classroomId?: string | null) {
    const id = classroomId?.trim() || "";
    if (!id) {
      return null;
    }

    const classroom = await this.classrooms.findOneBy({ id });
    if (!classroom) {
      throw new AppError(400, "Classroom not found", "CLASSROOM_NOT_FOUND");
    }

    return classroom;
  }

  private async assertClassroomFree(
    classroomId: string,
    startDate: string,
    endDate: string,
    options: {
      excludeIds: string[];
      academicYearId: string;
      yearLevelId: string;
    },
  ) {
    const occupied = await this.terms.find({
      where: { classroomId },
      relations: { academicYear: true, yearLevel: true },
    });
    const exclude = new Set(options.excludeIds);
    const conflict = occupied.find((term) => {
      if (exclude.has(term.id)) return false;
      if (
        term.academicYear?.id === options.academicYearId &&
        term.yearLevel?.id === options.yearLevelId
      ) {
        return false;
      }
      return datesOverlap(startDate, endDate, term.startDate, term.endDate);
    });

    if (!conflict) {
      return;
    }

    const year = conflict.academicYear?.year;
    const level = conflict.yearLevel?.name;
    const label =
      year && level ? `${conflict.name} (${year} · ${level})` : conflict.name;

    throw new AppError(
      409,
      `Classroom is already assigned to ${label}`,
      "CLASSROOM_OCCUPIED",
    );
  }

  private async syncClassesForTerm(term: Term) {
    const owned = await this.classes.find({
      where: { term: { id: term.id } },
    });
    if (owned.length === 0) {
      return;
    }

    const classroomId = term.classroomId;
    const room = term.classroom?.name ?? "";

    for (const cls of owned) {
      cls.classroomId = classroomId;
      cls.room = room;
      await this.classes.save(cls);
      await this.sessions
        .createQueryBuilder()
        .update(Session)
        .set({ classroomId, room })
        .where("classId = :classId", { classId: cls.id })
        .execute();
    }
  }

  private async findTermOrThrow(id: string) {
    const term = await this.terms.findOne({
      where: { id },
      relations: { academicYear: true, yearLevel: true, classroom: true },
    });
    if (!term) {
      throw new AppError(404, "Term not found", "TERM_NOT_FOUND");
    }
    return term;
  }

  private async assertTermUnique(
    name: string,
    academicYearId: string,
    yearLevelId: string,
    excludeId?: string,
  ) {
    const query = this.terms
      .createQueryBuilder("term")
      .where("LOWER(term.name) = LOWER(:name)", { name })
      .andWhere("term.academicYearId = :academicYearId", { academicYearId })
      .andWhere("term.yearLevelId = :yearLevelId", { yearLevelId });

    if (excludeId) {
      query.andWhere("term.id != :excludeId", { excludeId });
    }

    const existing = await query.getOne();
    if (existing) {
      throw new AppError(
        409,
        "A term with this name already exists for this year and level",
        "TERM_NAME_IN_USE",
      );
    }
  }
}

export const adminTermsService = new AdminTermsService();
