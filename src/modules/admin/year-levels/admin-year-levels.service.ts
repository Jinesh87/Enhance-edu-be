import { AppDataSource } from "../../../config/data-source.js";
import { YearLevel } from "../../../entities/index.js";

function toYearLevelDto(yearLevel: YearLevel) {
  return {
    id: yearLevel.id,
    name: yearLevel.name,
    sequence: yearLevel.sequence,
    createdAt: yearLevel.createdAt,
    updatedAt: yearLevel.updatedAt,
  };
}

export class AdminYearLevelsService {
  private readonly yearLevels = AppDataSource.getRepository(YearLevel);

  async list() {
    await this.ensureDefaultYearLevels();

    const rows = await this.yearLevels.find({
      order: { sequence: "ASC", name: "ASC" },
    });
    return rows.map(toYearLevelDto);
  }

  private async ensureDefaultYearLevels() {
    const count = await this.yearLevels.count();
    if (count > 0) {
      return;
    }

    const defaults = Array.from({ length: 12 }, (_, index) =>
      this.yearLevels.create({
        name: `Year ${index + 1}`,
        sequence: index + 1,
      }),
    );
    await this.yearLevels.save(defaults);
  }
}

export const adminYearLevelsService = new AdminYearLevelsService();
