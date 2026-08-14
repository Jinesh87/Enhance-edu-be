import { AppDataSource } from "../../../config/data-source.js";
import { AppError } from "../../../common/errors/AppError.js";
import { Subject } from "../../../entities/index.js";

function toSubjectDto(subject: Subject) {
  return {
    id: subject.id,
    name: subject.name,
    createdAt: subject.createdAt,
    updatedAt: subject.updatedAt,
  };
}

export class AdminSubjectsService {
  private readonly subjects = AppDataSource.getRepository(Subject);

  async list() {
    const subjects = await this.subjects.find({
      order: { name: "ASC" },
    });
    return subjects.map(toSubjectDto);
  }

  async create(nameInput: string) {
    const name = nameInput.trim();
    if (!name) {
      throw new AppError(400, "Subject name is required", "VALIDATION_ERROR");
    }

    await this.assertNameAvailable(name);

    const subject = this.subjects.create({ name });
    await this.subjects.save(subject);
    return toSubjectDto(subject);
  }

  async update(id: string, nameInput: string) {
    const subject = await this.findSubjectOrThrow(id);
    const name = nameInput.trim();
    if (!name) {
      throw new AppError(400, "Subject name is required", "VALIDATION_ERROR");
    }

    await this.assertNameAvailable(name, id);

    subject.name = name;
    await this.subjects.save(subject);
    return toSubjectDto(subject);
  }

  async remove(id: string) {
    const subject = await this.findSubjectOrThrow(id);
    await this.subjects.remove(subject);
  }

  private async findSubjectOrThrow(id: string) {
    const subject = await this.subjects.findOne({ where: { id } });
    if (!subject) {
      throw new AppError(404, "Subject not found", "SUBJECT_NOT_FOUND");
    }
    return subject;
  }

  private async assertNameAvailable(name: string, excludeId?: string) {
    const query = this.subjects
      .createQueryBuilder("subject")
      .where("LOWER(subject.name) = LOWER(:name)", { name });

    if (excludeId) {
      query.andWhere("subject.id != :excludeId", { excludeId });
    }

    const existing = await query.getOne();
    if (existing) {
      throw new AppError(
        409,
        "A subject with this name already exists",
        "SUBJECT_NAME_IN_USE",
      );
    }
  }
}

export const adminSubjectsService = new AdminSubjectsService();
