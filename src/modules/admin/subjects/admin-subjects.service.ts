import { AppDataSource } from "../../../config/data-source.js";
import { AppError } from "../../../common/errors/AppError.js";
import { Subject, YearLevel } from "../../../entities/index.js";

function toSubjectDto(subject: Subject) {
  return {
    id: subject.id,
    name: subject.name,
    yearLevel: subject.yearLevel
      ? {
          id: subject.yearLevel.id,
          name: subject.yearLevel.name,
          sequence: subject.yearLevel.sequence,
        }
      : null,
    createdAt: subject.createdAt,
    updatedAt: subject.updatedAt,
  };
}

export class AdminSubjectsService {
  private readonly subjects = AppDataSource.getRepository(Subject);
  private readonly yearLevels = AppDataSource.getRepository(YearLevel);

  async list() {
    const subjects = await this.subjects.find({
      relations: { yearLevel: true },
      order: { name: "ASC" },
    });
    return subjects.map(toSubjectDto);
  }

  async create(nameInput: string, yearLevelIdInput?: string | null) {
    const name = nameInput.trim();
    const yearLevelId = yearLevelIdInput?.trim() || null;
    if (!name) {
      throw new AppError(400, "Subject name is required", "VALIDATION_ERROR");
    }

    const yearLevel = await this.resolveYearLevel(yearLevelId);
    await this.assertNameAvailable(name, yearLevel?.id ?? null);

    const subject = this.subjects.create({ name, yearLevel });
    await this.subjects.save(subject);

    const saved = await this.subjects.findOne({
      where: { id: subject.id },
      relations: { yearLevel: true },
    });
    return toSubjectDto(saved!);
  }

  async update(
    id: string,
    nameInput: string,
    yearLevelIdInput?: string | null,
  ) {
    const subject = await this.findSubjectOrThrow(id);
    const name = nameInput.trim();
    const yearLevelId = yearLevelIdInput?.trim() || null;
    if (!name) {
      throw new AppError(400, "Subject name is required", "VALIDATION_ERROR");
    }

    const yearLevel = await this.resolveYearLevel(yearLevelId);
    await this.assertNameAvailable(name, yearLevel?.id ?? null, id);

    subject.name = name;
    subject.yearLevel = yearLevel;
    await this.subjects.save(subject);

    const saved = await this.subjects.findOne({
      where: { id: subject.id },
      relations: { yearLevel: true },
    });
    return toSubjectDto(saved!);
  }

  async remove(id: string) {
    const subject = await this.findSubjectOrThrow(id);
    await this.subjects.remove(subject);
  }

  private async resolveYearLevel(yearLevelId: string | null) {
    if (!yearLevelId) {
      return null;
    }

    const yearLevel = await this.yearLevels.findOne({ where: { id: yearLevelId } });
    if (!yearLevel) {
      throw new AppError(400, "Year level not found", "YEAR_LEVEL_NOT_FOUND");
    }
    return yearLevel;
  }

  private async findSubjectOrThrow(id: string) {
    const subject = await this.subjects.findOne({
      where: { id },
      relations: { yearLevel: true },
    });
    if (!subject) {
      throw new AppError(404, "Subject not found", "SUBJECT_NOT_FOUND");
    }
    return subject;
  }

  private async assertNameAvailable(
    name: string,
    yearLevelId: string | null,
    excludeId?: string,
  ) {
    const query = this.subjects
      .createQueryBuilder("subject")
      .where("LOWER(subject.name) = LOWER(:name)", { name });

    if (yearLevelId) {
      query.andWhere("subject.yearLevelId = :yearLevelId", { yearLevelId });
    } else {
      query.andWhere("subject.yearLevelId IS NULL");
    }

    if (excludeId) {
      query.andWhere("subject.id != :excludeId", { excludeId });
    }

    const existing = await query.getOne();
    if (existing) {
      throw new AppError(
        409,
        "A subject with this name and year level already exists",
        "SUBJECT_NAME_IN_USE",
      );
    }
  }
}

export const adminSubjectsService = new AdminSubjectsService();
