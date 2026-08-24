import { AppDataSource } from "../../config/data-source.js";
import { AppError } from "../../common/errors/AppError.js";
import { Classroom } from "../../entities/index.js";

type ClassroomInput = {
  name: string;
  code: string;
  capacity?: number | null;
  isActive?: boolean;
};

function toClassroomDto(classroom: Classroom) {
  return {
    id: classroom.id,
    name: classroom.name,
    code: classroom.code,
    capacity: classroom.capacity,
    isActive: classroom.isActive,
    createdAt: classroom.createdAt,
    updatedAt: classroom.updatedAt,
  };
}

export class ClassroomsService {
  private readonly classrooms = AppDataSource.getRepository(Classroom);

  async list(filters?: { isActive?: boolean }) {
    const classrooms = await this.classrooms.find({
      where:
        filters?.isActive === undefined
          ? undefined
          : { isActive: filters.isActive },
      order: { name: "ASC", code: "ASC" },
    });

    return classrooms.map(toClassroomDto);
  }

  async create(input: ClassroomInput) {
    const payload = this.normalizeInput(input);
    await this.assertCodeUnique(payload.code);

    const classroom = this.classrooms.create({
      name: payload.name,
      code: payload.code,
      capacity: payload.capacity,
      isActive: payload.isActive,
    });
    await this.classrooms.save(classroom);

    return toClassroomDto(await this.findOrThrow(classroom.id));
  }

  async update(id: string, input: ClassroomInput) {
    const classroom = await this.findOrThrow(id);
    const payload = this.normalizeInput(input, classroom.isActive);
    await this.assertCodeUnique(payload.code, id);

    classroom.name = payload.name;
    classroom.code = payload.code;
    classroom.capacity = payload.capacity;
    classroom.isActive = payload.isActive;
    await this.classrooms.save(classroom);

    return toClassroomDto(await this.findOrThrow(classroom.id));
  }

  private normalizeInput(input: ClassroomInput, fallbackActive = true) {
    const name = input.name.trim();
    const code = input.code.trim();

    if (!name) {
      throw new AppError(400, "Classroom name is required", "VALIDATION_ERROR");
    }
    if (!code) {
      throw new AppError(400, "Classroom code is required", "VALIDATION_ERROR");
    }

    return {
      name,
      code,
      capacity: input.capacity ?? null,
      isActive: input.isActive ?? fallbackActive,
    };
  }

  private async findOrThrow(id: string) {
    const classroom = await this.classrooms.findOne({ where: { id } });
    if (!classroom) {
      throw new AppError(404, "Classroom not found", "CLASSROOM_NOT_FOUND");
    }
    return classroom;
  }

  private async assertCodeUnique(code: string, excludeId?: string) {
    const query = this.classrooms
      .createQueryBuilder("classroom")
      .where("LOWER(classroom.code) = LOWER(:code)", { code });

    if (excludeId) {
      query.andWhere("classroom.id != :excludeId", { excludeId });
    }

    const existing = await query.getOne();
    if (existing) {
      throw new AppError(
        409,
        "A classroom with this code already exists",
        "CLASSROOM_CODE_IN_USE",
      );
    }
  }
}

export const classroomsService = new ClassroomsService();
