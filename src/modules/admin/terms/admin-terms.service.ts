import { AppDataSource } from "../../../config/data-source.js";
import { AppError } from "../../../common/errors/AppError.js";
import { Term } from "../../../entities/index.js";

type TermInput = {
  name: string;
  startDate: string;
  endDate: string;
};

function toTermDto(term: Term) {
  return {
    id: term.id,
    name: term.name,
    startDate: term.startDate,
    endDate: term.endDate,
    createdAt: term.createdAt,
    updatedAt: term.updatedAt,
  };
}

export class AdminTermsService {
  private readonly terms = AppDataSource.getRepository(Term);

  async list() {
    const terms = await this.terms.find({
      order: { startDate: "DESC" },
    });
    return terms.map(toTermDto);
  }

  async create(input: TermInput) {
    const payload = this.normalizeInput(input);
    await this.assertNameAvailable(payload.name);

    const term = this.terms.create(payload);
    await this.terms.save(term);
    return toTermDto(term);
  }

  async update(id: string, input: TermInput) {
    const term = await this.findTermOrThrow(id);
    const payload = this.normalizeInput(input);
    await this.assertNameAvailable(payload.name, id);

    term.name = payload.name;
    term.startDate = payload.startDate;
    term.endDate = payload.endDate;
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

    if (!name) {
      throw new AppError(400, "Term name is required", "VALIDATION_ERROR");
    }

    if (endDate < startDate) {
      throw new AppError(
        400,
        "End date must be on or after the start date",
        "VALIDATION_ERROR",
      );
    }

    return { name, startDate, endDate };
  }

  private async findTermOrThrow(id: string) {
    const term = await this.terms.findOne({ where: { id } });
    if (!term) {
      throw new AppError(404, "Term not found", "TERM_NOT_FOUND");
    }
    return term;
  }

  private async assertNameAvailable(name: string, excludeId?: string) {
    const query = this.terms
      .createQueryBuilder("term")
      .where("LOWER(term.name) = LOWER(:name)", { name });

    if (excludeId) {
      query.andWhere("term.id != :excludeId", { excludeId });
    }

    const existing = await query.getOne();
    if (existing) {
      throw new AppError(
        409,
        "A term with this name already exists",
        "TERM_NAME_IN_USE",
      );
    }
  }
}

export const adminTermsService = new AdminTermsService();
