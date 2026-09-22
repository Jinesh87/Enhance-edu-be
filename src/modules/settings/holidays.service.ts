import { AppDataSource } from "../../config/data-source.js";
import { AppError } from "../../common/errors/AppError.js";
import {
  Assessment,
  Holiday,
  Term,
  Session,
  type HolidayKind,
} from "../../entities/index.js";
import {
  applyHolidayScheduleAuthority,
  expandDateRange,
} from "../../common/utils/class-session-purge.js";
import {
  calendarDateInTimeZone,
  DEFAULT_CLASS_TIMEZONE,
} from "../../common/utils/timezone.js";

type HolidayInput = {
  name: string;
  kind: HolidayKind;
  termId?: string | null;
  startDate: string;
  endDate: string;
  /** @deprecated Holiday always clears schedule; kept for API compatibility. */
  cancelConflictingSessions?: boolean;
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
        ? [
            { kind: "PUBLIC" as HolidayKind },
            { kind: "TERM" as HolidayKind, termId: filters.termId },
          ]
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

    const rows =
      filters?.termId && filters?.kind
        ? holidays.filter((holiday) => holiday.kind === filters.kind)
        : holidays;

    return rows.map(toHolidayDto);
  }

  async checkConflicts(input: {
    startDate: string;
    endDate: string;
    kind: HolidayKind;
    termId?: string | null;
  }) {
    const startDate = input.startDate?.trim();
    const endDate = input.endDate?.trim();
    if (!startDate || !endDate) {
      return { conflictsCount: 0, sessions: [], assessments: [] };
    }

    const dates = expandDateRange(startDate, endDate);
    const dateSet = new Set(dates);
    const startBuffer = new Date(
      Date.parse(`${startDate}T00:00:00.000Z`) - 24 * 60 * 60 * 1000,
    );
    const endBuffer = new Date(
      Date.parse(`${endDate}T23:59:59.999Z`) + 24 * 60 * 60 * 1000,
    );

    const sessionQb = AppDataSource.getRepository(Session)
      .createQueryBuilder("session")
      .leftJoinAndSelect("session.class", "class")
      .leftJoinAndSelect("class.teacher", "teacher")
      .leftJoinAndSelect("session.assessment", "assessment")
      .leftJoinAndSelect("assessment.teacher", "assessmentTeacher")
      .where(
        "session.startAt >= :startBuffer AND session.startAt <= :endBuffer",
        { startBuffer, endBuffer },
      );

    if (input.kind === "TERM" && input.termId) {
      sessionQb.andWhere(
        "(class.termId = :termId OR assessment.termId = :termId)",
        { termId: input.termId },
      );
    }

    const sessions = await sessionQb.orderBy("session.startAt", "ASC").getMany();
    const matchedSessions = sessions.filter((s) => {
      const tz =
        s.class?.timeZone ||
        s.assessment?.timeZone ||
        DEFAULT_CLASS_TIMEZONE;
      const dateKey = calendarDateInTimeZone(s.startAt, tz);
      return dateSet.has(dateKey);
    });

    const assessmentQb = AppDataSource.getRepository(Assessment)
      .createQueryBuilder("assessment")
      .leftJoinAndSelect("assessment.teacher", "teacher")
      .where("assessment.assessmentDate >= :startDate", { startDate })
      .andWhere("assessment.assessmentDate <= :endDate", { endDate })
      .andWhere("assessment.status NOT IN (:...excluded)", {
        excluded: ["ARCHIVED", "CANCELLED"],
      });

    if (input.kind === "TERM" && input.termId) {
      assessmentQb.andWhere("assessment.termId = :termId", {
        termId: input.termId,
      });
    }

    const assessments = (await assessmentQb.getMany()).filter((row) =>
      dateSet.has(String(row.assessmentDate).slice(0, 10)),
    );

    const sessionRows = matchedSessions.map((s) => ({
      id: s.id,
      kind: s.assessmentId ? ("assessment" as const) : ("class" as const),
      className:
        s.class?.name ??
        s.assessment?.name ??
        (s.assessmentId ? "Assessment" : "Class"),
      classCode: s.class?.code ?? "",
      subject: s.class?.subject ?? s.assessment?.subject ?? "",
      teacherName:
        s.class?.teacher?.fullName ??
        s.assessment?.teacher?.fullName ??
        null,
      room: s.room || s.class?.room || s.assessment?.room || null,
      startAt: s.startAt.toISOString(),
      endAt: s.endAt.toISOString(),
    }));

    const assessmentRows = assessments.map((a) => ({
      id: a.id,
      name: a.name,
      subject: a.subject,
      scheduleType: a.scheduleType,
      assessmentDate: String(a.assessmentDate).slice(0, 10),
      startTime: a.startTime,
      teacherName: a.teacher?.fullName ?? null,
    }));

    return {
      conflictsCount: sessionRows.length + assessmentRows.length,
      sessions: sessionRows,
      assessments: assessmentRows,
    };
  }

  async create(input: HolidayInput) {
    const payload = await this.normalizeInput(input);
    await this.assertNameUnique(payload.name, payload.kind, payload.termId);

    // Holiday wins: clear class sessions + assessments first, then save holiday.
    await applyHolidayScheduleAuthority({
      startDate: payload.startDate,
      endDate: payload.endDate,
      termId: payload.kind === "TERM" ? payload.termId : null,
    });

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

    await applyHolidayScheduleAuthority({
      startDate: payload.startDate,
      endDate: payload.endDate,
      termId: payload.kind === "TERM" ? payload.termId : null,
    });

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
