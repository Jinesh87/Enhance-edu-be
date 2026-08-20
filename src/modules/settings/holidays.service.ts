import { AppDataSource } from "../../config/data-source.js";
import { AppError } from "../../common/errors/AppError.js";
import { Holiday, Term, type HolidayKind } from "../../entities/index.js";

type HolidayInput = {
  name: string;
  kind: HolidayKind;
  termId?: string | null;
  startDate: string;
  endDate: string;
};

function toHolidayDto(holiday: Holiday) {
  return {
    id: holiday.id,
    name: holiday.name,
    kind: holiday.kind,
    term: holiday.term
      ? {
          id: holiday.term.id,
          name: holiday.term.name,
          startDate: holiday.term.startDate,
          endDate: holiday.term.endDate,
          academicYear: holiday.term.academicYear
            ? {
                id: holiday.term.academicYear.id,
                year: holiday.term.academicYear.year,
                displayName: holiday.term.academicYear.displayName,
              }
            : undefined,
          yearLevel: holiday.term.yearLevel
            ? {
                id: holiday.term.yearLevel.id,
                name: holiday.term.yearLevel.name,
                sequence: holiday.term.yearLevel.sequence,
              }
            : undefined,
        }
      : null,
    startDate: holiday.startDate,
    endDate: holiday.endDate,
    createdAt: holiday.createdAt,
    updatedAt: holiday.updatedAt,
  };
}

export class HolidaysService {
  private readonly holidays = AppDataSource.getRepository(Holiday);
  private readonly terms = AppDataSource.getRepository(Term);

  async list(filters?: { kind?: HolidayKind; termId?: string }) {
    const holidays = await this.holidays.find({
      where: filters?.termId
        ? [{ kind: "PUBLIC" as HolidayKind }, { kind: "TERM" as HolidayKind, termId: filters.termId }]
        : filters?.kind
          ? { kind: filters.kind }
          : undefined,
      relations: {
        term: {
          academicYear: true,
          yearLevel: true,
        },
      },
      order: { startDate: "ASC", name: "ASC" },
    });

    // When termId is set with an optional kind filter, narrow after fetch.
    const rows =
      filters?.termId && filters?.kind
        ? holidays.filter((holiday) => holiday.kind === filters.kind)
        : holidays;

    return rows.map(toHolidayDto);
  }

  async create(input: HolidayInput) {
    const payload = await this.normalizeInput(input);
    await this.assertNameUnique(payload.name, payload.kind, payload.termId);

    const holiday = this.holidays.create({
      name: payload.name,
      kind: payload.kind,
      term: payload.term,
      termId: payload.termId,
      startDate: payload.startDate,
      endDate: payload.endDate,
    });
    await this.holidays.save(holiday);

    const saved = await this.findOrThrow(holiday.id);
    return toHolidayDto(saved);
  }

  async update(id: string, input: HolidayInput) {
    const holiday = await this.findOrThrow(id);
    const payload = await this.normalizeInput(input);
    await this.assertNameUnique(
      payload.name,
      payload.kind,
      payload.termId,
      id,
    );

    holiday.name = payload.name;
    holiday.kind = payload.kind;
    holiday.term = payload.term;
    holiday.termId = payload.termId;
    holiday.startDate = payload.startDate;
    holiday.endDate = payload.endDate;
    await this.holidays.save(holiday);

    const saved = await this.findOrThrow(holiday.id);
    return toHolidayDto(saved);
  }

  async remove(id: string) {
    const holiday = await this.findOrThrow(id);
    await this.holidays.remove(holiday);
  }

  private async normalizeInput(input: HolidayInput) {
    const name = input.name.trim();
    const startDate = input.startDate.trim();
    const endDate = input.endDate.trim();
    const kind = input.kind;

    if (!name) {
      throw new AppError(400, "Holiday name is required", "VALIDATION_ERROR");
    }

    if (endDate < startDate) {
      throw new AppError(
        400,
        "End date must be on or after the start date",
        "VALIDATION_ERROR",
      );
    }

    if (kind === "PUBLIC") {
      return {
        name,
        kind,
        term: null as Term | null,
        termId: null as string | null,
        startDate,
        endDate,
      };
    }

    const termId = input.termId?.trim();
    if (!termId) {
      throw new AppError(
        400,
        "Term is required for term-specific holidays",
        "VALIDATION_ERROR",
      );
    }

    const term = await this.terms.findOne({
      where: { id: termId },
      relations: { academicYear: true, yearLevel: true },
    });
    if (!term) {
      throw new AppError(404, "Term not found", "TERM_NOT_FOUND");
    }

    if (startDate < term.startDate || endDate > term.endDate) {
      throw new AppError(
        400,
        "Holiday dates must fall within the selected term",
        "VALIDATION_ERROR",
      );
    }

    return {
      name,
      kind,
      term,
      termId: term.id,
      startDate,
      endDate,
    };
  }

  private async findOrThrow(id: string) {
    const holiday = await this.holidays.findOne({
      where: { id },
      relations: {
        term: {
          academicYear: true,
          yearLevel: true,
        },
      },
    });
    if (!holiday) {
      throw new AppError(404, "Holiday not found", "HOLIDAY_NOT_FOUND");
    }
    return holiday;
  }

  private async assertNameUnique(
    name: string,
    kind: HolidayKind,
    termId: string | null,
    excludeId?: string,
  ) {
    const query = this.holidays
      .createQueryBuilder("holiday")
      .where("LOWER(holiday.name) = LOWER(:name)", { name })
      .andWhere("holiday.kind = :kind", { kind });

    if (kind === "TERM") {
      query.andWhere("holiday.termId = :termId", { termId });
    } else {
      query.andWhere("holiday.termId IS NULL");
    }

    if (excludeId) {
      query.andWhere("holiday.id != :excludeId", { excludeId });
    }

    const existing = await query.getOne();
    if (existing) {
      throw new AppError(
        409,
        kind === "TERM"
          ? "A holiday with this name already exists for this term"
          : "A public holiday with this name already exists",
        "HOLIDAY_NAME_IN_USE",
      );
    }
  }
}

export const holidaysService = new HolidaysService();
