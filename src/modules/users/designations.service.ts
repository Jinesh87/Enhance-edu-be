import { AppDataSource } from "../../config/data-source.js";
import { AppError } from "../../common/errors/AppError.js";
import { StaffDesignation, User } from "../../entities/index.js";
import { UserRole } from "../../common/constants/roles.js";

export type DesignationDto = {
  id: string;
  name: string;
  staffCount: number;
};

class DesignationsService {
  private get repo() {
    return AppDataSource.getRepository(StaffDesignation);
  }

  async list(): Promise<DesignationDto[]> {
    const rows = await this.repo.find({ order: { name: "ASC" } });
    const counts: { designation: string; count: string }[] = await AppDataSource
      .getRepository(User)
      .createQueryBuilder("u")
      .select("u.designation", "designation")
      .addSelect("COUNT(*)", "count")
      .where("u.role = :role", { role: UserRole.OFFICE_STAFF })
      .andWhere("u.designation IS NOT NULL")
      .groupBy("u.designation")
      .getRawMany();
    const byName = new Map(counts.map((c) => [c.designation.toLowerCase(), Number(c.count)]));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      staffCount: byName.get(row.name.toLowerCase()) ?? 0,
    }));
  }

  async create(name: string, userId: string): Promise<DesignationDto> {
    const trimmed = name.trim().replace(/\s+/g, " ");
    if (!trimmed) {
      throw new AppError(400, "Designation name is required", "VALIDATION_ERROR");
    }
    const existing = await this.repo
      .createQueryBuilder("d")
      .where("LOWER(d.name) = LOWER(:name)", { name: trimmed })
      .getOne();
    if (existing) {
      return { id: existing.id, name: existing.name, staffCount: 0 };
    }
    const saved = await this.repo.save(
      this.repo.create({ name: trimmed, createdById: userId }),
    );
    return { id: saved.id, name: saved.name, staffCount: 0 };
  }

  async remove(id: string): Promise<void> {
    const result = await this.repo.delete({ id });
    if (!result.affected) {
      throw new AppError(404, "Designation not found", "NOT_FOUND");
    }
  }
}

export const designationsService = new DesignationsService();
