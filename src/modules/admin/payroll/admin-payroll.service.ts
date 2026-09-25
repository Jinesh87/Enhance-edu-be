import { IsNull } from "typeorm";
import { AppDataSource } from "../../../config/data-source.js";
import { AppError } from "../../../common/errors/AppError.js";
import { UserRole, UserStatus } from "../../../common/constants/roles.js";
import {
  TeacherPayrollConfig,
  PayrollPayBasis,
} from "../../../entities/TeacherPayrollConfig.js";
import { TeacherPayrollRateHistory } from "../../../entities/TeacherPayrollRateHistory.js";
import { User } from "../../../entities/User.js";
import { settingsService } from "../../settings/settings.service.js";
import { dayBoundsInClassTz } from "../ai/tool-helpers.js";

export type PayrollPeriodQuery = {
  from?: string;
  to?: string;
};

export type UpsertPayrollConfigInput = {
  teacherUserId: string;
  payBasis: PayrollPayBasis;
  rate: number;
  currency?: string;
  isActive?: boolean;
  /** YYYY-MM-DD — new rate applies from this date forward. Defaults to today. */
  effectiveFrom?: string;
};

type SessionPayrollRow = {
  sessionId: string;
  classId: string | null;
  className: string | null;
  subject: string | null;
  startAt: Date;
  endAt: Date;
  teacherUserId: string;
  attendeeCount: number;
  durationHours: number;
};

type RateSlice = {
  payBasis: PayrollPayBasis;
  rate: number;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
};

type PricedSession = SessionPayrollRow & {
  appliedRate: number;
  appliedPayBasis: PayrollPayBasis;
  appliedCurrency: string;
  sessionLocalDate: string;
};

function parseYmd(value?: string): string | undefined {
  if (!value?.trim()) return undefined;
  const v = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw new AppError(400, "Invalid date (use YYYY-MM-DD)", "INVALID_DATE");
  }
  return v;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundHours(n: number): number {
  return Math.round(n * 100) / 100;
}

function isoWeekKey(d: Date, timeZone: string): string {
  const key = d.toLocaleDateString("en-CA", { timeZone });
  const [y, m, day] = key.split("-").map(Number);
  const utc = new Date(Date.UTC(y!, m! - 1, day!));
  const dayNum = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function monthKey(d: Date, timeZone: string): string {
  return d.toLocaleDateString("en-CA", { timeZone }).slice(0, 7);
}

function dayKey(d: Date, timeZone: string): string {
  return d.toLocaleDateString("en-CA", { timeZone });
}

class AdminPayrollService {
  private readonly configs = AppDataSource.getRepository(TeacherPayrollConfig);
  private readonly history =
    AppDataSource.getRepository(TeacherPayrollRateHistory);
  private readonly users = AppDataSource.getRepository(User);

  async assertEnabled() {
    const enabled = await settingsService.isTeacherPayrollEnabled();
    if (!enabled) {
      throw new AppError(
        403,
        "Teacher payroll is disabled. Enable it in Institution settings.",
        "PAYROLL_DISABLED",
      );
    }
  }

  async getFeatureFlag() {
    return {
      enabled: await settingsService.isTeacherPayrollEnabled(),
    };
  }

  /**
   * Month-to-date payroll totals for the admin dashboard.
   * Returns null when teacher payroll is disabled.
   */
  async getMonthToDateTotals() {
    const enabled = await settingsService.isTeacherPayrollEnabled();
    if (!enabled) return null;

    const period = this.resolvePeriod({});
    const sessions = await this.loadCountableSessions({
      from: period.from,
      toExclusive: period.toExclusive,
    });
    const teacherIds = [
      ...new Set(sessions.map((s) => s.teacherUserId)),
    ];
    const historyByTeacher = await this.loadRateHistory(teacherIds);
    const configs = await this.configs.find();
    const configByTeacher = new Map(
      configs.map((c) => [c.teacherUserId, c] as const),
    );

    let sessionsCount = 0;
    let attendees = 0;
    let hours = 0;
    let amount = 0;
    let currency = "AUD";

    const sessionsByTeacher = new Map<string, SessionPayrollRow[]>();
    for (const session of sessions) {
      const list = sessionsByTeacher.get(session.teacherUserId) ?? [];
      list.push(session);
      sessionsByTeacher.set(session.teacherUserId, list);
    }

    for (const [teacherUserId, teacherSessions] of sessionsByTeacher) {
      const config = configByTeacher.get(teacherUserId) ?? null;
      const history = historyByTeacher.get(teacherUserId) ?? [];
      const priced = this.priceSessions({
        sessions: teacherSessions,
        history,
        timeZone: period.timeZone,
      });
      const pay = this.computePayFromPriced({
        sessions: priced,
        timeZone: period.timeZone,
        fallbackBasis: config?.payBasis ?? PayrollPayBasis.HOURLY,
      });

      sessionsCount += teacherSessions.length;
      attendees += teacherSessions.reduce((sum, s) => sum + s.attendeeCount, 0);
      hours += pay.totalHours;
      if (config?.isActive) {
        amount += pay.amount;
        currency = config.currency || currency;
      }
    }

    return {
      period: { from: period.fromLabel, to: period.toLabel },
      sessions: sessionsCount,
      hours: Math.round(hours * 100) / 100,
      attendees,
      amount: Math.round(amount * 100) / 100,
      currency,
    };
  }

  private resolvePeriod(query: PayrollPeriodQuery) {
    const fromYmd = parseYmd(query.from);
    const toYmd = parseYmd(query.to);
    const today = dayBoundsInClassTz();
    const from = fromYmd
      ? dayBoundsInClassTz(fromYmd).start
      : dayBoundsInClassTz(`${today.label.slice(0, 8)}01`).start;
    const toExclusive = toYmd
      ? dayBoundsInClassTz(toYmd).end
      : today.end;
    if (from >= toExclusive) {
      throw new AppError(
        400,
        "Period start must be before period end",
        "INVALID_PERIOD",
      );
    }
    return {
      from,
      toExclusive,
      fromLabel: fromYmd ?? `${today.label.slice(0, 8)}01`,
      toLabel: toYmd ?? today.label,
      timeZone: today.timeZone,
    };
  }

  private async loadCountableSessions(params: {
    teacherUserId?: string;
    from: Date;
    toExclusive: Date;
  }): Promise<SessionPayrollRow[]> {
    const paramsList: unknown[] = [params.from, params.toExclusive];
    let teacherFilter = "";
    if (params.teacherUserId) {
      paramsList.push(params.teacherUserId);
      teacherFilter = `AND COALESCE(s."teacherId", c."teacherId") = $3`;
    }

    const rows = (await AppDataSource.query(
      `
      SELECT
        s.id AS "sessionId",
        s."classId" AS "classId",
        c.name AS "className",
        c.subject AS subject,
        s."startAt" AS "startAt",
        s."endAt" AS "endAt",
        COALESCE(s."teacherId", c."teacherId") AS "teacherUserId",
        COUNT(ar.id) FILTER (
          WHERE ar.status IN ('PRESENT', 'LATE')
        )::int AS "attendeeCount",
        EXTRACT(EPOCH FROM (s."endAt" - s."startAt")) / 3600.0 AS "durationHours"
      FROM sessions s
      LEFT JOIN classes c ON c.id = s."classId"
      LEFT JOIN attendance_records ar ON ar."sessionId" = s.id
      WHERE s."endAt" < now()
        AND s."startAt" >= $1
        AND s."startAt" < $2
        AND COALESCE(s."teacherId", c."teacherId") IS NOT NULL
        ${teacherFilter}
      GROUP BY
        s.id, s."classId", c.name, c.subject, s."startAt", s."endAt",
        COALESCE(s."teacherId", c."teacherId")
      HAVING COUNT(ar.id) FILTER (
        WHERE ar.status IN ('PRESENT', 'LATE')
      ) >= 1
      ORDER BY s."startAt" ASC
      `,
      paramsList,
    )) as Array<{
      sessionId: string;
      classId: string | null;
      className: string | null;
      subject: string | null;
      startAt: Date;
      endAt: Date;
      teacherUserId: string;
      attendeeCount: number;
      durationHours: string | number;
    }>;

    return rows.map((row) => ({
      sessionId: row.sessionId,
      classId: row.classId,
      className: row.className,
      subject: row.subject,
      startAt: new Date(row.startAt),
      endAt: new Date(row.endAt),
      teacherUserId: row.teacherUserId,
      attendeeCount: Number(row.attendeeCount) || 0,
      durationHours: roundHours(Number(row.durationHours) || 0),
    }));
  }

  private async loadRateHistory(
    teacherUserIds: string[],
  ): Promise<Map<string, RateSlice[]>> {
    const map = new Map<string, RateSlice[]>();
    if (teacherUserIds.length === 0) return map;

    const rows = await this.history
      .createQueryBuilder("h")
      .where("h.teacherUserId IN (:...ids)", { ids: teacherUserIds })
      .orderBy("h.effectiveFrom", "ASC")
      .getMany();

    for (const row of rows) {
      const list = map.get(row.teacherUserId) ?? [];
      list.push({
        payBasis: row.payBasis,
        rate: Number(row.rate),
        currency: row.currency,
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
      });
      map.set(row.teacherUserId, list);
    }
    return map;
  }

  private rateForDate(
    history: RateSlice[],
    localDate: string,
  ): RateSlice | null {
    // Latest slice whose effectiveFrom <= date and (effectiveTo is null or date < effectiveTo)
    let match: RateSlice | null = null;
    for (const slice of history) {
      if (slice.effectiveFrom > localDate) break;
      if (slice.effectiveTo && !(localDate < slice.effectiveTo)) continue;
      match = slice;
    }
    return match;
  }

  private priceSessions(params: {
    sessions: SessionPayrollRow[];
    history: RateSlice[];
    timeZone: string;
  }): PricedSession[] {
    return params.sessions.map((session) => {
      const sessionLocalDate = dayKey(session.startAt, params.timeZone);
      const slice = this.rateForDate(params.history, sessionLocalDate);
      return {
        ...session,
        sessionLocalDate,
        appliedRate: slice?.rate ?? 0,
        appliedPayBasis: slice?.payBasis ?? PayrollPayBasis.HOURLY,
        appliedCurrency: slice?.currency ?? "AUD",
      };
    });
  }

  /**
   * Pay uses the rate that was effective on each session's local date.
   * HOURLY: sum(hours × sessionRate)
   * DAILY/WEEKLY/MONTHLY: one unit per unique day/week/month, charged at the
   * rate of the first session in that unit.
   */
  private computePayFromPriced(params: {
    sessions: PricedSession[];
    timeZone: string;
    fallbackBasis: PayrollPayBasis;
  }) {
    const { sessions, timeZone, fallbackBasis } = params;
    const totalHours = roundHours(
      sessions.reduce((sum, s) => sum + s.durationHours, 0),
    );

    if (sessions.length === 0) {
      return {
        totalHours: 0,
        billableUnits: 0,
        amount: 0,
        payBasis: fallbackBasis,
      };
    }

    // Prefer the most common basis among priced sessions; else fallback.
    const basisCounts = new Map<PayrollPayBasis, number>();
    for (const s of sessions) {
      basisCounts.set(
        s.appliedPayBasis,
        (basisCounts.get(s.appliedPayBasis) ?? 0) + 1,
      );
    }
    let payBasis = fallbackBasis;
    let best = 0;
    for (const [basis, count] of basisCounts) {
      if (count > best) {
        best = count;
        payBasis = basis;
      }
    }

    if (payBasis === PayrollPayBasis.HOURLY) {
      const amount = roundMoney(
        sessions.reduce((sum, s) => sum + s.durationHours * s.appliedRate, 0),
      );
      return {
        totalHours,
        billableUnits: totalHours,
        amount,
        payBasis,
      };
    }

    const unitKey =
      payBasis === PayrollPayBasis.DAILY
        ? (s: PricedSession) => dayKey(s.startAt, timeZone)
        : payBasis === PayrollPayBasis.WEEKLY
          ? (s: PricedSession) => isoWeekKey(s.startAt, timeZone)
          : (s: PricedSession) => monthKey(s.startAt, timeZone);

    const firstByUnit = new Map<string, PricedSession>();
    for (const session of sessions) {
      const key = unitKey(session);
      if (!firstByUnit.has(key)) firstByUnit.set(key, session);
    }

    let amount = 0;
    for (const session of firstByUnit.values()) {
      amount += session.appliedRate;
    }

    return {
      totalHours,
      billableUnits: firstByUnit.size,
      amount: roundMoney(amount),
      payBasis,
    };
  }

  async list(query: PayrollPeriodQuery, options: { includeSessions?: boolean } = {}) {
    await this.assertEnabled();
    const period = this.resolvePeriod(query);

    const teachers = await this.users.find({
      where: { role: UserRole.STAFF },
      order: { fullName: "ASC" },
    });
    const configs = await this.configs.find();
    const configByTeacher = new Map(
      configs.map((c) => [c.teacherUserId, c] as const),
    );

    const sessions = await this.loadCountableSessions({
      from: period.from,
      toExclusive: period.toExclusive,
    });
    const sessionsByTeacher = new Map<string, SessionPayrollRow[]>();
    for (const session of sessions) {
      const list = sessionsByTeacher.get(session.teacherUserId) ?? [];
      list.push(session);
      sessionsByTeacher.set(session.teacherUserId, list);
    }

    const historyByTeacher = await this.loadRateHistory(
      teachers.map((t) => t.id),
    );

    const items = teachers.map((teacher) => {
      const config = configByTeacher.get(teacher.id) ?? null;
      const teacherSessions = sessionsByTeacher.get(teacher.id) ?? [];
      const history = historyByTeacher.get(teacher.id) ?? [];
      const priced = this.priceSessions({
        sessions: teacherSessions,
        history,
        timeZone: period.timeZone,
      });
      const pay = this.computePayFromPriced({
        sessions: priced,
        timeZone: period.timeZone,
        fallbackBasis: config?.payBasis ?? PayrollPayBasis.HOURLY,
      });

      return {
        teacherUserId: teacher.id,
        fullName: teacher.fullName,
        preferredName: teacher.preferredName,
        email: teacher.email,
        status: teacher.status,
        config: config
          ? {
              id: config.id,
              payBasis: config.payBasis,
              rate: Number(config.rate),
              currency: config.currency,
              isActive: config.isActive,
            }
          : null,
        summary: {
          sessionCount: teacherSessions.length,
          totalAttendees: teacherSessions.reduce(
            (sum, s) => sum + s.attendeeCount,
            0,
          ),
          totalHours: pay.totalHours,
          billableUnits: pay.billableUnits,
          amount: config && config.isActive ? pay.amount : null,
          currency: config?.currency ?? "AUD",
        },
        ...(options.includeSessions
          ? {
              sessions: priced.map((s) => ({
                sessionId: s.sessionId,
                className: s.className,
                subject: s.subject,
                startAt: s.startAt.toISOString(),
                sessionLocalDate: s.sessionLocalDate,
                durationHours: s.durationHours,
                attendeeCount: s.attendeeCount,
                appliedRate: s.appliedRate,
                appliedPayBasis: s.appliedPayBasis,
                appliedCurrency: s.appliedCurrency,
              })),
            }
          : {}),
      };
    });

    return {
      enabled: true,
      period: {
        from: period.fromLabel,
        to: period.toLabel,
      },
      items,
    };
  }

  async getTeacherDetail(teacherUserId: string, query: PayrollPeriodQuery) {
    await this.assertEnabled();
    const period = this.resolvePeriod(query);

    const teacher = await this.users.findOne({
      where: { id: teacherUserId, role: UserRole.STAFF },
    });
    if (!teacher) {
      throw new AppError(404, "Teacher not found", "TEACHER_NOT_FOUND");
    }

    const config = await this.configs.findOne({
      where: { teacherUserId },
    });
    const sessions = await this.loadCountableSessions({
      teacherUserId,
      from: period.from,
      toExclusive: period.toExclusive,
    });
    const historyByTeacher = await this.loadRateHistory([teacherUserId]);
    const history = historyByTeacher.get(teacherUserId) ?? [];
    const priced = this.priceSessions({
      sessions,
      history,
      timeZone: period.timeZone,
    });
    const pay = this.computePayFromPriced({
      sessions: priced,
      timeZone: period.timeZone,
      fallbackBasis: config?.payBasis ?? PayrollPayBasis.HOURLY,
    });

    return {
      teacher: {
        teacherUserId: teacher.id,
        fullName: teacher.fullName,
        preferredName: teacher.preferredName,
        email: teacher.email,
        status: teacher.status,
      },
      config: config
        ? {
            id: config.id,
            payBasis: config.payBasis,
            rate: Number(config.rate),
            currency: config.currency,
            isActive: config.isActive,
          }
        : null,
      rateHistory: history.map((h) => ({
        payBasis: h.payBasis,
        rate: h.rate,
        currency: h.currency,
        effectiveFrom: h.effectiveFrom,
        effectiveTo: h.effectiveTo,
      })),
      period: {
        from: period.fromLabel,
        to: period.toLabel,
      },
      summary: {
        sessionCount: sessions.length,
        totalAttendees: sessions.reduce((sum, s) => sum + s.attendeeCount, 0),
        totalHours: pay.totalHours,
        billableUnits: pay.billableUnits,
        amount: config && config.isActive ? pay.amount : null,
        currency: config?.currency ?? "AUD",
        payBasis: pay.payBasis,
        rate: config ? Number(config.rate) : 0,
      },
      sessions: priced.map((s) => ({
        sessionId: s.sessionId,
        classId: s.classId,
        className: s.className,
        subject: s.subject,
        startAt: s.startAt.toISOString(),
        endAt: s.endAt.toISOString(),
        durationHours: s.durationHours,
        attendeeCount: s.attendeeCount,
        appliedRate: s.appliedRate,
        appliedPayBasis: s.appliedPayBasis,
        appliedCurrency: s.appliedCurrency,
        sessionLocalDate: s.sessionLocalDate,
      })),
    };
  }

  async upsertConfig(input: UpsertPayrollConfigInput) {
    await this.assertEnabled();

    const teacher = await this.users.findOne({
      where: { id: input.teacherUserId, role: UserRole.STAFF },
    });
    if (!teacher) {
      throw new AppError(404, "Teacher not found", "TEACHER_NOT_FOUND");
    }
    if (!Number.isFinite(input.rate) || input.rate < 0) {
      throw new AppError(400, "Rate must be a non-negative number", "INVALID_RATE");
    }
    if (!Object.values(PayrollPayBasis).includes(input.payBasis)) {
      throw new AppError(400, "Invalid pay basis", "INVALID_PAY_BASIS");
    }

    const today = dayBoundsInClassTz().label;
    const effectiveFrom =
      parseYmd(input.effectiveFrom) ?? today;
    const currency = (input.currency || "AUD").slice(0, 8).toUpperCase();
    const rateStr = input.rate.toFixed(2);

    let row = await this.configs.findOne({
      where: { teacherUserId: input.teacherUserId },
    });

    const openHistory = await this.history.findOne({
      where: {
        teacherUserId: input.teacherUserId,
        effectiveTo: IsNull(),
      },
      order: { effectiveFrom: "DESC" },
    });

    const rateChanged =
      !openHistory ||
      Number(openHistory.rate) !== input.rate ||
      openHistory.payBasis !== input.payBasis ||
      openHistory.currency !== currency;

    if (!row) {
      // First config: cover all past sessions with this rate.
      row = this.configs.create({
        teacherUserId: input.teacherUserId,
        payBasis: input.payBasis,
        rate: rateStr,
        currency,
        isActive: input.isActive ?? true,
      });
      await this.configs.save(row);
      await this.history.save(
        this.history.create({
          teacherUserId: input.teacherUserId,
          payBasis: input.payBasis,
          rate: rateStr,
          currency,
          effectiveFrom: "1970-01-01",
          effectiveTo: null,
        }),
      );
    } else {
      row.payBasis = input.payBasis;
      row.rate = rateStr;
      if (input.currency) row.currency = currency;
      if (typeof input.isActive === "boolean") row.isActive = input.isActive;
      await this.configs.save(row);

      if (rateChanged) {
        if (openHistory) {
          if (effectiveFrom <= openHistory.effectiveFrom) {
            throw new AppError(
              400,
              "New rate must start after the current rate's effective date",
              "INVALID_EFFECTIVE_FROM",
            );
          }
          openHistory.effectiveTo = effectiveFrom;
          await this.history.save(openHistory);
        }
        await this.history.save(
          this.history.create({
            teacherUserId: input.teacherUserId,
            payBasis: input.payBasis,
            rate: rateStr,
            currency,
            effectiveFrom,
            effectiveTo: null,
          }),
        );
      }
    }

    return {
      id: row.id,
      teacherUserId: row.teacherUserId,
      payBasis: row.payBasis,
      rate: Number(row.rate),
      currency: row.currency,
      isActive: row.isActive,
      effectiveFrom,
      teacherStatus: teacher.status as UserStatus,
    };
  }
}

export const adminPayrollService = new AdminPayrollService();
