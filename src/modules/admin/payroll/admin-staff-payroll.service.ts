import { IsNull } from "typeorm";
import { AppDataSource } from "../../../config/data-source.js";
import { AppError } from "../../../common/errors/AppError.js";
import { UserRole } from "../../../common/constants/roles.js";
import {
  StaffPayBasis,
  StaffPayrollConfig,
} from "../../../entities/StaffPayrollConfig.js";
import { StaffPayrollRateHistory } from "../../../entities/StaffPayrollRateHistory.js";
import {
  StaffWorkEntry,
  StaffWorkUnit,
} from "../../../entities/StaffWorkEntry.js";
import { User } from "../../../entities/User.js";
import { dayBoundsInClassTz } from "../ai/tool-helpers.js";
import { adminPayrollService } from "./admin-payroll.service.js";

export type StaffPeriodQuery = { from?: string; to?: string };

export type UpsertStaffConfigInput = {
  staffUserId: string;
  payBasis: StaffPayBasis;
  rate: number;
  currency?: string;
  isActive?: boolean;
  effectiveFrom?: string;
};

export type WorkEntryInput = {
  workDate: string;
  quantity: number;
  notes?: string | null;
};

type RateSlice = {
  payBasis: StaffPayBasis;
  rate: number;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
};

const STAFF_ROLES = [UserRole.OFFICE_STAFF];

function parseYmd(value?: string): string | undefined {
  if (!value?.trim()) return undefined;
  const v = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw new AppError(400, "Invalid date (use YYYY-MM-DD)", "INVALID_DATE");
  }
  return v;
}

function roundMoney(n: number) {
  return Math.round(n * 100) / 100;
}

function unitForBasis(basis: StaffPayBasis): StaffWorkUnit {
  return basis === StaffPayBasis.DAILY ? StaffWorkUnit.DAYS : StaffWorkUnit.HOURS;
}

function rateForDate(history: RateSlice[], date: string): RateSlice | null {
  let match: RateSlice | null = null;
  for (const slice of history) {
    if (slice.effectiveFrom > date) break;
    if (slice.effectiveTo && !(date < slice.effectiveTo)) continue;
    match = slice;
  }
  return match;
}

function configDto(config: StaffPayrollConfig | null) {
  return config
    ? {
        id: config.id,
        payBasis: config.payBasis,
        rate: Number(config.rate),
        currency: config.currency,
        isActive: config.isActive,
      }
    : null;
}

class AdminStaffPayrollService {
  private readonly configs = AppDataSource.getRepository(StaffPayrollConfig);
  private readonly history = AppDataSource.getRepository(StaffPayrollRateHistory);
  private readonly entries = AppDataSource.getRepository(StaffWorkEntry);
  private readonly users = AppDataSource.getRepository(User);

  private resolvePeriod(query: StaffPeriodQuery) {
    const today = dayBoundsInClassTz().label;
    const from = parseYmd(query.from) ?? `${today.slice(0, 8)}01`;
    const to = parseYmd(query.to) ?? today;
    if (from > to) {
      throw new AppError(400, "Period start must be on or before period end", "INVALID_PERIOD");
    }
    return { from, to, today };
  }

  private async findStaff(staffUserId: string) {
    const staff = await this.users.findOne({ where: { id: staffUserId } });
    if (!staff || !STAFF_ROLES.includes(staff.role as UserRole)) {
      throw new AppError(404, "Staff member not found", "STAFF_NOT_FOUND");
    }
    return staff;
  }

  private async loadHistory(staffUserIds: string[]) {
    const map = new Map<string, RateSlice[]>();
    if (staffUserIds.length === 0) return map;
    const rows = await this.history
      .createQueryBuilder("h")
      .where("h.staffUserId IN (:...ids)", { ids: staffUserIds })
      .orderBy("h.effectiveFrom", "ASC")
      .getMany();
    for (const row of rows) {
      const list = map.get(row.staffUserId) ?? [];
      list.push({
        payBasis: row.payBasis,
        rate: Number(row.rate),
        currency: row.currency,
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
      });
      map.set(row.staffUserId, list);
    }
    return map;
  }

  /**
   * Entries are paid at the rate locked onto them when logged. Older rows
   * without a locked rate fall back to the rate in effect on the work date;
   * if that rate's unit differs from the entry's, it is priced at 0 and flagged.
   */
  private priceEntries(entries: StaffWorkEntry[], history: RateSlice[]) {
    return entries.map((entry) => {
      const quantity = Number(entry.quantity);
      if (entry.rate != null && entry.payBasis) {
        const rate = Number(entry.rate);
        return {
          id: entry.id,
          workDate: entry.workDate,
          unit: entry.unit,
          quantity,
          notes: entry.notes,
          appliedRate: rate,
          appliedPayBasis: entry.payBasis,
          appliedCurrency: entry.currency ?? "AUD",
          amount: roundMoney(quantity * rate),
          needsReview: false,
        };
      }
      const slice = rateForDate(history, entry.workDate);
      const matches = slice ? unitForBasis(slice.payBasis) === entry.unit : false;
      return {
        id: entry.id,
        workDate: entry.workDate,
        unit: entry.unit,
        quantity,
        notes: entry.notes,
        appliedRate: slice?.rate ?? 0,
        appliedPayBasis: slice?.payBasis ?? null,
        appliedCurrency: slice?.currency ?? "AUD",
        amount: slice && matches ? roundMoney(quantity * slice.rate) : 0,
        needsReview: !slice || !matches,
      };
    });
  }

  private summarize(
    priced: ReturnType<AdminStaffPayrollService["priceEntries"]>,
    config: StaffPayrollConfig | null,
  ) {
    const hours = priced
      .filter((e) => e.unit === StaffWorkUnit.HOURS)
      .reduce((sum, e) => sum + e.quantity, 0);
    const days = priced
      .filter((e) => e.unit === StaffWorkUnit.DAYS)
      .reduce((sum, e) => sum + e.quantity, 0);
    const amount = roundMoney(priced.reduce((sum, e) => sum + e.amount, 0));
    return {
      entryCount: priced.length,
      totalHours: roundMoney(hours),
      totalDays: roundMoney(days),
      needsReview: priced.filter((e) => e.needsReview).length,
      amount: config && config.isActive ? amount : null,
      currency: config?.currency ?? "AUD",
    };
  }

  private async loadEntries(staffUserIds: string[], from: string, to: string) {
    if (staffUserIds.length === 0) return [];
    return this.entries
      .createQueryBuilder("e")
      .where("e.staffUserId IN (:...ids)", { ids: staffUserIds })
      .andWhere("e.workDate BETWEEN :from AND :to", { from, to })
      .orderBy("e.workDate", "ASC")
      .addOrderBy("e.createdAt", "ASC")
      .getMany();
  }

  async list(query: StaffPeriodQuery, options: { includeEntries?: boolean } = {}) {
    await adminPayrollService.assertEnabled();
    const period = this.resolvePeriod(query);

    const staff = await this.users
      .createQueryBuilder("u")
      .where("u.role IN (:...roles)", { roles: STAFF_ROLES })
      .orderBy("u.fullName", "ASC")
      .getMany();
    const ids = staff.map((s) => s.id);
    const configs = ids.length
      ? await this.configs
          .createQueryBuilder("c")
          .where("c.staffUserId IN (:...ids)", { ids })
          .getMany()
      : [];
    const configById = new Map(configs.map((c) => [c.staffUserId, c] as const));
    const historyById = await this.loadHistory(ids);
    const entries = await this.loadEntries(ids, period.from, period.to);
    const entriesById = new Map<string, StaffWorkEntry[]>();
    for (const entry of entries) {
      const list = entriesById.get(entry.staffUserId) ?? [];
      list.push(entry);
      entriesById.set(entry.staffUserId, list);
    }

    const items = staff.map((member) => {
      const config = configById.get(member.id) ?? null;
      const priced = this.priceEntries(
        entriesById.get(member.id) ?? [],
        historyById.get(member.id) ?? [],
      );
      return {
        staffUserId: member.id,
        fullName: member.fullName,
        preferredName: member.preferredName,
        email: member.email,
        status: member.status,
        config: configDto(config),
        summary: this.summarize(priced, config),
        ...(options.includeEntries ? { entries: priced } : {}),
      };
    });

    return { period: { from: period.from, to: period.to }, items };
  }

  async detail(staffUserId: string, query: StaffPeriodQuery) {
    await adminPayrollService.assertEnabled();
    const period = this.resolvePeriod(query);
    const staff = await this.findStaff(staffUserId);
    const config = await this.configs.findOne({ where: { staffUserId } });
    const history = (await this.loadHistory([staffUserId])).get(staffUserId) ?? [];
    const entries = await this.loadEntries([staffUserId], period.from, period.to);
    const priced = this.priceEntries(entries, history);

    return {
      staff: {
        staffUserId: staff.id,
        fullName: staff.fullName,
        preferredName: staff.preferredName,
        email: staff.email,
        status: staff.status,
      },
      config: configDto(config),
      rateHistory: history,
      period: { from: period.from, to: period.to },
      summary: this.summarize(priced, config),
      entries: priced,
    };
  }

  async upsertConfig(input: UpsertStaffConfigInput) {
    await adminPayrollService.assertEnabled();
    await this.findStaff(input.staffUserId);
    if (!Object.values(StaffPayBasis).includes(input.payBasis)) {
      throw new AppError(400, "Invalid pay basis", "INVALID_PAY_BASIS");
    }
    if (!Number.isFinite(input.rate) || input.rate < 0) {
      throw new AppError(400, "Rate must be a non-negative number", "INVALID_RATE");
    }

    const today = dayBoundsInClassTz().label;
    const effectiveFrom = parseYmd(input.effectiveFrom) ?? today;
    const currency = (input.currency || "AUD").slice(0, 8).toUpperCase();
    const rateStr = input.rate.toFixed(2);

    return AppDataSource.transaction(async (manager) => {
      const configs = manager.getRepository(StaffPayrollConfig);
      const history = manager.getRepository(StaffPayrollRateHistory);

      let row = await configs.findOne({ where: { staffUserId: input.staffUserId } });
      const open = await history.findOne({
        where: { staffUserId: input.staffUserId, effectiveTo: IsNull() },
        order: { effectiveFrom: "DESC" },
      });

      if (!row) {
        row = await configs.save(
          configs.create({
            staffUserId: input.staffUserId,
            payBasis: input.payBasis,
            rate: rateStr,
            currency,
            isActive: input.isActive ?? true,
          }),
        );
        await history.save(
          history.create({
            staffUserId: input.staffUserId,
            payBasis: input.payBasis,
            rate: rateStr,
            currency,
            effectiveFrom: "1970-01-01",
            effectiveTo: null,
          }),
        );
      } else {
        const rateChanged =
          !open ||
          Number(open.rate) !== input.rate ||
          open.payBasis !== input.payBasis ||
          open.currency !== currency;

        if (rateChanged) {
          if (open) {
            if (effectiveFrom <= open.effectiveFrom) {
              throw new AppError(
                400,
                "New rate must start after the current rate's effective date",
                "INVALID_EFFECTIVE_FROM",
              );
            }
            open.effectiveTo = effectiveFrom;
            await history.save(open);
          }
          await history.save(
            history.create({
              staffUserId: input.staffUserId,
              payBasis: input.payBasis,
              rate: rateStr,
              currency,
              effectiveFrom,
              effectiveTo: null,
            }),
          );
        }

        row.payBasis = input.payBasis;
        row.rate = rateStr;
        row.currency = currency;
        if (typeof input.isActive === "boolean") row.isActive = input.isActive;
        await configs.save(row);
      }

      return { ...configDto(row)!, staffUserId: row.staffUserId, effectiveFrom };
    });
  }

  private async resolveSlice(staffUserId: string, workDate: string) {
    const history = (await this.loadHistory([staffUserId])).get(staffUserId) ?? [];
    const slice = rateForDate(history, workDate);
    if (!slice) {
      throw new AppError(
        400,
        "Set a pay rate for this staff member before logging work",
        "STAFF_RATE_NOT_SET",
      );
    }
    return slice;
  }

  private validateEntry(input: WorkEntryInput, unit: StaffWorkUnit) {
    const workDate = parseYmd(input.workDate);
    if (!workDate) throw new AppError(400, "Work date is required", "INVALID_DATE");
    const today = dayBoundsInClassTz().label;
    if (workDate > today) {
      throw new AppError(400, "Work date can't be in the future", "FUTURE_WORK_DATE");
    }
    const max = unit === StaffWorkUnit.HOURS ? 24 : 1;
    if (!Number.isFinite(input.quantity) || input.quantity <= 0 || input.quantity > max) {
      throw new AppError(
        400,
        unit === StaffWorkUnit.HOURS
          ? "Hours must be more than 0 and at most 24"
          : "Days must be more than 0 and at most 1 per entry",
        "INVALID_QUANTITY",
      );
    }
    return workDate;
  }

  async createEntry(staffUserId: string, input: WorkEntryInput, userId?: string) {
    await adminPayrollService.assertEnabled();
    await this.findStaff(staffUserId);
    const slice = await this.resolveSlice(staffUserId, parseYmd(input.workDate) ?? "");
    const unit = unitForBasis(slice.payBasis);
    const workDate = this.validateEntry(input, unit);
    const saved = await this.entries.save(
      this.entries.create({
        staffUserId,
        workDate,
        unit,
        quantity: input.quantity.toFixed(2),
        rate: slice.rate.toFixed(2),
        payBasis: slice.payBasis,
        currency: slice.currency,
        notes: input.notes?.trim() || null,
        createdById: userId ?? null,
      }),
    );
    return { id: saved.id };
  }

  async updateEntry(entryId: string, input: WorkEntryInput) {
    await adminPayrollService.assertEnabled();
    const entry = await this.entries.findOne({ where: { id: entryId } });
    if (!entry) throw new AppError(404, "Work entry not found", "WORK_ENTRY_NOT_FOUND");
    const workDate = parseYmd(input.workDate) ?? "";
    // Keep the locked rate unless the entry moves to another date (or predates locking).
    if (entry.rate == null || entry.workDate !== workDate) {
      const slice = await this.resolveSlice(entry.staffUserId, workDate);
      entry.unit = unitForBasis(slice.payBasis);
      entry.rate = slice.rate.toFixed(2);
      entry.payBasis = slice.payBasis;
      entry.currency = slice.currency;
    }
    entry.workDate = this.validateEntry(input, entry.unit);
    entry.quantity = input.quantity.toFixed(2);
    entry.notes = input.notes?.trim() || null;
    await this.entries.save(entry);
    return { id: entry.id };
  }

  async deleteEntry(entryId: string) {
    await adminPayrollService.assertEnabled();
    const result = await this.entries.delete({ id: entryId });
    if (!result.affected) {
      throw new AppError(404, "Work entry not found", "WORK_ENTRY_NOT_FOUND");
    }
    return { id: entryId };
  }
}

export const adminStaffPayrollService = new AdminStaffPayrollService();
