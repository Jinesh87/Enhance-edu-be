import { AppDataSource } from "../../../config/data-source.js";
import { AppError } from "../../../common/errors/AppError.js";
import { Term, AcademicYear, YearLevel } from "../../../entities/index.js";

type TermInput = {
  name: string;
  academicYear: number;
  yearLevel: string;
  startDate: string;
  endDate: string;
};

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
    startDate: term.startDate,
    endDate: term.endDate,
    createdAt: term.createdAt,
    updatedAt: term.updatedAt,
  };
}

export class AdminTermsService {
  private readonly terms = AppDataSource.getRepository(Term);
  private readonly academicYears = AppDataSource.getRepository(AcademicYear);
  private readonly yearLevels = AppDataSource.getRepository(YearLevel);

  async list() {
    const terms = await this.terms.find({
      relations: { academicYear: true, yearLevel: true },
      order: { startDate: "DESC" },
    });
    return terms.map(toTermDto);
  }

  async create(input: TermInput) {
    const payload = this.normalizeInput(input);

    // Find or create AcademicYear
    let academicYear = await this.academicYears.findOneBy({ year: payload.academicYear });
    if (!academicYear) {
      academicYear = this.academicYears.create({
        year: payload.academicYear,
        displayName: `${payload.academicYear}`,
      });
      await this.academicYears.save(academicYear);
    }

    // Find or create YearLevel
    let yearLevel = await this.yearLevels.findOneBy({ name: payload.yearLevel });
    if (!yearLevel) {
      const match = payload.yearLevel.match(/\d+/);
      const seq = match ? parseInt(match[0], 10) : 0;
      yearLevel = this.yearLevels.create({
        name: payload.yearLevel,
        sequence: seq,
      });
      await this.yearLevels.save(yearLevel);
    }

    // Assert name + academicYear + yearLevel is unique
    await this.assertTermUnique(payload.name, academicYear.id, yearLevel.id);

    const term = this.terms.create({
      name: payload.name,
      startDate: payload.startDate,
      endDate: payload.endDate,
      academicYear,
      yearLevel,
    });
    await this.terms.save(term);
    return toTermDto(term);
  }

  async update(id: string, input: TermInput) {
    const term = await this.findTermOrThrow(id);
    const payload = this.normalizeInput(input);

    // Find or create AcademicYear
    let academicYear = await this.academicYears.findOneBy({ year: payload.academicYear });
    if (!academicYear) {
      academicYear = this.academicYears.create({
        year: payload.academicYear,
        displayName: `${payload.academicYear}`,
      });
      await this.academicYears.save(academicYear);
    }

    // Find or create YearLevel
    let yearLevel = await this.yearLevels.findOneBy({ name: payload.yearLevel });
    if (!yearLevel) {
      const match = payload.yearLevel.match(/\d+/);
      const seq = match ? parseInt(match[0], 10) : 0;
      yearLevel = this.yearLevels.create({
        name: payload.yearLevel,
        sequence: seq,
      });
      await this.yearLevels.save(yearLevel);
    }

    // Assert name + academicYear + yearLevel is unique
    await this.assertTermUnique(payload.name, academicYear.id, yearLevel.id, id);

    term.name = payload.name;
    term.startDate = payload.startDate;
    term.endDate = payload.endDate;
    term.academicYear = academicYear;
    term.yearLevel = yearLevel;
    await this.terms.save(term);
    return toTermDto(term);
  }

  async remove(id: string) {
    const term = await this.findTermOrThrow(id);
    await this.terms.remove(term);
  }

  private normalizeInput(input: TermInput) {
    const name = input.name.trim();
    const startDate = input.startDate.trim();
    const endDate = input.endDate.trim();
    const academicYear = input.academicYear;
    const yearLevel = input.yearLevel.trim();

    if (!name) {
      throw new AppError(400, "Term name is required", "VALIDATION_ERROR");
    }

    if (!academicYear) {
      throw new AppError(400, "Academic year is required", "VALIDATION_ERROR");
    }

    if (!yearLevel) {
      throw new AppError(400, "Level of study is required", "VALIDATION_ERROR");
    }

    if (endDate < startDate) {
      throw new AppError(
        400,
        "End date must be on or after the start date",
        "VALIDATION_ERROR",
      );
    }

    return { name, academicYear, yearLevel, startDate, endDate };
  }

  private async findTermOrThrow(id: string) {
    const term = await this.terms.findOne({
      where: { id },
      relations: { academicYear: true, yearLevel: true },
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
