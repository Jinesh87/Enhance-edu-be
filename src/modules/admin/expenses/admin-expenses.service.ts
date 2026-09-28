import { IsNull } from "typeorm";
import { AppDataSource } from "../../../config/data-source.js";
import { AppError } from "../../../common/errors/AppError.js";
import {
  FixedExpense,
  FixedExpenseFrequency,
} from "../../../entities/FixedExpense.js";
import { FixedExpenseAmountHistory } from "../../../entities/FixedExpenseAmountHistory.js";
import { VariableExpense } from "../../../entities/VariableExpense.js";
import { VariableExpenseHead } from "../../../entities/VariableExpenseHead.js";
import { settingsService } from "../../settings/settings.service.js";
import { dayBoundsInClassTz } from "../ai/tool-helpers.js";

export type ExpensePeriodQuery = {
  from?: string;
  to?: string;
};

export type CreateFixedExpenseInput = {
  name: string;
  category: string;
  frequency: FixedExpenseFrequency;
  amount: number;
  startDate: string;
  endDate?: string | null;
  currency?: string;
  notes?: string | null;
};

export type UpdateFixedExpenseInput = {
  name?: string;
  category?: string;
  endDate?: string | null;
  notes?: string | null;
  amount?: number;
  /** YYYY-MM-DD — new amount applies to occurrences on/after this date. Defaults to today. */
  effectiveFrom?: string;
};

export type ExpenseHeadInput = {
  title: string;
  category: string;
};

export type ExpenseLogInput = {
  amount: number;
  expenseDate: string;
  currency?: string;
  notes?: string | null;
};

type AmountSlice = {
  amount: number;
  effectiveFrom: string;
  effectiveTo: string | null;
};

const DEFAULT_CURRENCY = "AUD";
const MAX_OCCURRENCES_PER_EXPENSE = 2000;

const MONTH_STEP: Record<FixedExpenseFrequency, number> = {
  [FixedExpenseFrequency.WEEKLY]: 0,
  [FixedExpenseFrequency.MONTHLY]: 1,
  [FixedExpenseFrequency.QUARTERLY]: 3,
  [FixedExpenseFrequency.YEARLY]: 12,
};

function parseYmd(value?: string | null): string | undefined {
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

function ymdToUtc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

function utcToYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(ymd: string, days: number): string {
  const d = ymdToUtc(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return utcToYmd(d);
}

function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.round(
    (ymdToUtc(toYmd).getTime() - ymdToUtc(fromYmd).getTime()) / 86_400_000,
  );
}

/** Adds months to an anchor date, clamping the day (e.g. Jan 31 → Feb 28). */
function addMonthsAnchored(anchorYmd: string, months: number): string {
  const [y, m, d] = anchorYmd.split("-").map(Number);
  const totalMonths = y! * 12 + (m! - 1) + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = totalMonths % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return utcToYmd(
    new Date(Date.UTC(targetYear, targetMonth, Math.min(d!, lastDay))),
  );
}

function monthsBetween(fromYmd: string, toYmd: string): number {
  const [fy, fm] = fromYmd.split("-").map(Number);
  const [ty, tm] = toYmd.split("-").map(Number);
  return (ty! - fy!) * 12 + (tm! - fm!);
}

/** Due dates of a fixed expense that fall inside [fromYmd, toYmd]. */
function occurrenceDates(
  expense: Pick<FixedExpense, "frequency" | "startDate" | "endDate">,
  fromYmd: string,
  toYmd: string,
): string[] {
  const upper =
    expense.endDate && expense.endDate < toYmd ? expense.endDate : toYmd;
  if (expense.startDate > upper) return [];

  const dates: string[] = [];
  if (expense.frequency === FixedExpenseFrequency.WEEKLY) {
    const skip = Math.max(0, Math.ceil(daysBetween(expense.startDate, fromYmd) / 7));
    for (let k = skip; dates.length < MAX_OCCURRENCES_PER_EXPENSE; k += 1) {
      const date = addDays(expense.startDate, k * 7);
      if (date > upper) break;
      if (date >= fromYmd) dates.push(date);
    }
    return dates;
  }

  const step = MONTH_STEP[expense.frequency];
  const skip = Math.max(
    0,
    Math.floor(monthsBetween(expense.startDate, fromYmd) / step) - 1,
  );
  for (let k = skip; dates.length < MAX_OCCURRENCES_PER_EXPENSE; k += 1) {
    const date = addMonthsAnchored(expense.startDate, k * step);
    if (date > upper) break;
    if (date >= fromYmd) dates.push(date);
  }
  return dates;
}

function amountForDate(history: AmountSlice[], ymd: string): number {
  let match: AmountSlice | null = null;
  for (const slice of history) {
    if (slice.effectiveFrom > ymd) break;
    if (slice.effectiveTo && !(ymd < slice.effectiveTo)) continue;
    match = slice;
  }
  return match?.amount ?? 0;
}

function cleanText(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeCurrency(value?: string) {
  return (value || DEFAULT_CURRENCY).trim().slice(0, 8).toUpperCase();
}

class AdminExpensesService {
  private readonly fixed = AppDataSource.getRepository(FixedExpense);
  private readonly history = AppDataSource.getRepository(
    FixedExpenseAmountHistory,
  );
  private readonly variable = AppDataSource.getRepository(VariableExpense);
  private readonly heads = AppDataSource.getRepository(VariableExpenseHead);

  async assertEnabled() {
    const enabled = await settingsService.isExpensesEnabled();
    if (!enabled) {
      throw new AppError(
        403,
        "Expenses are disabled. Enable them in Institution settings.",
        "EXPENSES_DISABLED",
      );
    }
  }

  async getFeatureFlag() {
    return { enabled: await settingsService.isExpensesEnabled() };
  }

  private resolvePeriod(query: ExpensePeriodQuery) {
    const today = dayBoundsInClassTz().label;
    const from = parseYmd(query.from) ?? `${today.slice(0, 8)}01`;
    const to = parseYmd(query.to) ?? today;
    if (from > to) {
      throw new AppError(
        400,
        "Period start must be on or before period end",
        "INVALID_PERIOD",
      );
    }
    return { from, to, today };
  }

  private async loadHistory(
    fixedExpenseIds: string[],
  ): Promise<Map<string, AmountSlice[]>> {
    const map = new Map<string, AmountSlice[]>();
    if (fixedExpenseIds.length === 0) return map;
    const rows = await this.history
      .createQueryBuilder("h")
      .where("h.fixedExpenseId IN (:...ids)", { ids: fixedExpenseIds })
      .orderBy("h.effectiveFrom", "ASC")
      .getMany();
    for (const row of rows) {
      const list = map.get(row.fixedExpenseId) ?? [];
      list.push({
        amount: Number(row.amount),
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
      });
      map.set(row.fixedExpenseId, list);
    }
    return map;
  }

  async overview(query: ExpensePeriodQuery) {
    await this.assertEnabled();
    const period = this.resolvePeriod(query);

    const [fixedRows, variableRows, headRows, headStats] = await Promise.all([
      this.fixed.find({ order: { name: "ASC" } }),
      this.variable
        .createQueryBuilder("v")
        .where("v.expenseDate >= :from AND v.expenseDate <= :to", {
          from: period.from,
          to: period.to,
        })
        .orderBy("v.expenseDate", "DESC")
        .addOrderBy("v.createdAt", "DESC")
        .getMany(),
      this.heads.find({ order: { title: "ASC" } }),
      this.variable
        .createQueryBuilder("v")
        .select('v."headId"', "headId")
        .addSelect("COUNT(*)::int", "logCount")
        .addSelect('MAX(v."expenseDate")', "lastExpenseDate")
        .where('v."headId" IS NOT NULL')
        .groupBy('v."headId"')
        .getRawMany<{ headId: string; logCount: number; lastExpenseDate: string }>(),
    ]);
    const historyById = await this.loadHistory(fixedRows.map((f) => f.id));

    const ledger: Array<{
      id: string;
      kind: "FIXED" | "VARIABLE";
      sourceId: string;
      date: string;
      name: string;
      category: string;
      amount: number;
      currency: string;
      frequency: FixedExpenseFrequency | null;
      headId: string | null;
    }> = [];

    const fixed = fixedRows.map((row) => {
      const history = historyById.get(row.id) ?? [];
      const dates = occurrenceDates(row, period.from, period.to);
      let periodTotal = 0;
      for (const date of dates) {
        const amount = amountForDate(history, date);
        periodTotal += amount;
        ledger.push({
          id: `${row.id}:${date}`,
          kind: "FIXED",
          sourceId: row.id,
          date,
          name: row.name,
          category: row.category,
          amount,
          currency: row.currency,
          frequency: row.frequency,
          headId: null,
        });
      }
      const current = history.find((h) => h.effectiveTo === null) ?? null;
      const status =
        row.startDate > period.today
          ? "SCHEDULED"
          : row.endDate && row.endDate < period.today
            ? "ENDED"
            : "ACTIVE";
      return {
        id: row.id,
        name: row.name,
        category: row.category,
        frequency: row.frequency,
        currency: row.currency,
        startDate: row.startDate,
        endDate: row.endDate,
        notes: row.notes,
        status,
        currentAmount: current?.amount ?? 0,
        amountHistory: history,
        periodOccurrences: dates.length,
        periodTotal: roundMoney(periodTotal),
      };
    });

    const variable = variableRows.map((row) => {
      ledger.push({
        id: row.id,
        kind: "VARIABLE",
        sourceId: row.id,
        date: row.expenseDate,
        name: row.title,
        category: row.category,
        amount: Number(row.amount),
        currency: row.currency,
        frequency: null,
        headId: row.headId,
      });
      return {
        id: row.id,
        headId: row.headId,
        title: row.title,
        category: row.category,
        amount: Number(row.amount),
        currency: row.currency,
        expenseDate: row.expenseDate,
        notes: row.notes,
      };
    });

    const statsByHead = new Map(headStats.map((s) => [s.headId, s] as const));
    const heads = headRows.map((head) => {
      const logs = variable.filter((v) => v.headId === head.id);
      const stats = statsByHead.get(head.id);
      return {
        id: head.id,
        title: head.title,
        category: head.category,
        periodCount: logs.length,
        periodTotal: roundMoney(logs.reduce((sum, v) => sum + v.amount, 0)),
        totalCount: Number(stats?.logCount ?? 0),
        lastExpenseDate: stats?.lastExpenseDate
          ? String(stats.lastExpenseDate).slice(0, 10)
          : null,
      };
    });

    ledger.sort((a, b) =>
      a.date === b.date ? a.name.localeCompare(b.name) : b.date.localeCompare(a.date),
    );

    const fixedTotal = roundMoney(fixed.reduce((sum, f) => sum + f.periodTotal, 0));
    const variableTotal = roundMoney(variable.reduce((sum, v) => sum + v.amount, 0));

    const byCategoryMap = new Map<string, number>();
    for (const entry of ledger) {
      byCategoryMap.set(
        entry.category,
        (byCategoryMap.get(entry.category) ?? 0) + entry.amount,
      );
    }
    const byCategory = [...byCategoryMap.entries()]
      .map(([category, amount]) => ({ category, amount: roundMoney(amount) }))
      .sort((a, b) => b.amount - a.amount);

    return {
      period: { from: period.from, to: period.to },
      summary: {
        total: roundMoney(fixedTotal + variableTotal),
        fixedTotal,
        variableTotal,
        fixedOccurrences: ledger.filter((e) => e.kind === "FIXED").length,
        variableCount: variable.length,
        activeFixed: fixed.filter((f) => f.status === "ACTIVE").length,
        currency:
          fixedRows[0]?.currency ?? variableRows[0]?.currency ?? DEFAULT_CURRENCY,
      },
      byCategory,
      ledger,
      fixed,
      variable,
      heads,
    };
  }

  async createFixed(input: CreateFixedExpenseInput, userId?: string) {
    await this.assertEnabled();
    const startDate = parseYmd(input.startDate)!;
    const endDate = parseYmd(input.endDate) ?? null;
    if (endDate && endDate < startDate) {
      throw new AppError(400, "End date must be on or after the start date", "INVALID_END_DATE");
    }

    return AppDataSource.transaction(async (manager) => {
      const row = await manager.getRepository(FixedExpense).save(
        manager.getRepository(FixedExpense).create({
          name: input.name.trim(),
          category: input.category.trim(),
          frequency: input.frequency,
          currency: normalizeCurrency(input.currency),
          startDate,
          endDate,
          notes: cleanText(input.notes),
          createdById: userId ?? null,
        }),
      );
      await manager.getRepository(FixedExpenseAmountHistory).save(
        manager.getRepository(FixedExpenseAmountHistory).create({
          fixedExpenseId: row.id,
          amount: input.amount.toFixed(2),
          effectiveFrom: startDate,
          effectiveTo: null,
        }),
      );
      return { id: row.id };
    });
  }

  async updateFixed(id: string, input: UpdateFixedExpenseInput) {
    await this.assertEnabled();
    const row = await this.fixed.findOne({ where: { id } });
    if (!row) {
      throw new AppError(404, "Fixed expense not found", "FIXED_EXPENSE_NOT_FOUND");
    }

    if (input.name !== undefined) row.name = input.name.trim();
    if (input.category !== undefined) row.category = input.category.trim();
    if (input.notes !== undefined) row.notes = cleanText(input.notes);
    if (input.endDate !== undefined) {
      const endDate = parseYmd(input.endDate) ?? null;
      if (endDate && endDate < row.startDate) {
        throw new AppError(400, "End date must be on or after the start date", "INVALID_END_DATE");
      }
      row.endDate = endDate;
    }

    await AppDataSource.transaction(async (manager) => {
      await manager.getRepository(FixedExpense).save(row);
      if (input.amount === undefined) return;

      const historyRepo = manager.getRepository(FixedExpenseAmountHistory);
      const open = await historyRepo.findOne({
        where: { fixedExpenseId: id, effectiveTo: IsNull() },
        order: { effectiveFrom: "DESC" },
      });
      const amountStr = input.amount.toFixed(2);
      if (open && Number(open.amount) === input.amount) return;

      const today = dayBoundsInClassTz().label;
      let effectiveFrom = parseYmd(input.effectiveFrom) ?? today;
      if (effectiveFrom < row.startDate) effectiveFrom = row.startDate;

      if (!open) {
        await historyRepo.save(
          historyRepo.create({
            fixedExpenseId: id,
            amount: amountStr,
            effectiveFrom: row.startDate,
            effectiveTo: null,
          }),
        );
        return;
      }
      if (effectiveFrom < open.effectiveFrom) {
        throw new AppError(
          400,
          `New amount must start on or after ${open.effectiveFrom}, when the current amount began`,
          "INVALID_EFFECTIVE_FROM",
        );
      }
      if (effectiveFrom === open.effectiveFrom) {
        // Same start date: treat as a correction of the current amount.
        open.amount = amountStr;
        await historyRepo.save(open);
        return;
      }
      open.effectiveTo = effectiveFrom;
      await historyRepo.save(open);
      await historyRepo.save(
        historyRepo.create({
          fixedExpenseId: id,
          amount: amountStr,
          effectiveFrom,
          effectiveTo: null,
        }),
      );
    });

    return { id };
  }

  async deleteFixed(id: string) {
    await this.assertEnabled();
    const result = await this.fixed.delete({ id });
    if (!result.affected) {
      throw new AppError(404, "Fixed expense not found", "FIXED_EXPENSE_NOT_FOUND");
    }
    return { id };
  }

  private async findHead(id: string) {
    const head = await this.heads.findOne({ where: { id } });
    if (!head) {
      throw new AppError(404, "Expense head not found", "EXPENSE_HEAD_NOT_FOUND");
    }
    return head;
  }

  async createHead(input: ExpenseHeadInput, userId?: string) {
    await this.assertEnabled();
    const head = await this.heads.save(
      this.heads.create({
        title: input.title.trim(),
        category: input.category.trim(),
        createdById: userId ?? null,
      }),
    );
    return { id: head.id };
  }

  async updateHead(id: string, input: ExpenseHeadInput) {
    await this.assertEnabled();
    const head = await this.findHead(id);
    head.title = input.title.trim();
    head.category = input.category.trim();
    await AppDataSource.transaction(async (manager) => {
      await manager.getRepository(VariableExpenseHead).save(head);
      await manager
        .getRepository(VariableExpense)
        .update({ headId: id }, { title: head.title, category: head.category });
    });
    return { id };
  }

  async deleteHead(id: string) {
    await this.assertEnabled();
    const result = await this.heads.delete({ id });
    if (!result.affected) {
      throw new AppError(404, "Expense head not found", "EXPENSE_HEAD_NOT_FOUND");
    }
    return { id };
  }

  /** One head with its logs in the period (newest first) and all-time totals. */
  async getHead(id: string, query: ExpensePeriodQuery) {
    await this.assertEnabled();
    const period = this.resolvePeriod(query);
    const head = await this.findHead(id);
    const [logs, allTime] = await Promise.all([
      this.variable
        .createQueryBuilder("v")
        .where('v."headId" = :id', { id })
        .andWhere("v.expenseDate >= :from AND v.expenseDate <= :to", {
          from: period.from,
          to: period.to,
        })
        .orderBy("v.expenseDate", "DESC")
        .addOrderBy("v.createdAt", "DESC")
        .getMany(),
      this.variable
        .createQueryBuilder("v")
        .select("COUNT(*)::int", "count")
        .addSelect("COALESCE(SUM(v.amount), 0)", "total")
        .where('v."headId" = :id', { id })
        .getRawOne<{ count: number; total: string }>(),
    ]);
    const items = logs.map((log) => ({
      id: log.id,
      headId: id,
      title: log.title,
      category: log.category,
      amount: Number(log.amount),
      currency: log.currency,
      expenseDate: log.expenseDate,
      notes: log.notes,
    }));
    const periodTotal = roundMoney(items.reduce((sum, l) => sum + l.amount, 0));
    return {
      head: { id: head.id, title: head.title, category: head.category },
      period: { from: period.from, to: period.to },
      summary: {
        periodTotal,
        periodCount: items.length,
        average: items.length ? roundMoney(periodTotal / items.length) : 0,
        allTimeTotal: roundMoney(Number(allTime?.total ?? 0)),
        allTimeCount: Number(allTime?.count ?? 0),
        currency: items[0]?.currency ?? DEFAULT_CURRENCY,
      },
      logs: items,
    };
  }

  async createLog(headId: string, input: ExpenseLogInput, userId?: string) {
    await this.assertEnabled();
    const head = await this.findHead(headId);
    const row = await this.variable.save(
      this.variable.create({
        headId: head.id,
        title: head.title,
        category: head.category,
        amount: input.amount.toFixed(2),
        currency: normalizeCurrency(input.currency),
        expenseDate: parseYmd(input.expenseDate)!,
        notes: cleanText(input.notes),
        createdById: userId ?? null,
      }),
    );
    return { id: row.id };
  }

  async updateVariable(id: string, input: ExpenseLogInput) {
    await this.assertEnabled();
    const row = await this.variable.findOne({ where: { id } });
    if (!row) {
      throw new AppError(404, "Expense not found", "VARIABLE_EXPENSE_NOT_FOUND");
    }
    row.amount = input.amount.toFixed(2);
    row.expenseDate = parseYmd(input.expenseDate)!;
    row.notes = cleanText(input.notes);
    if (input.currency) row.currency = normalizeCurrency(input.currency);
    await this.variable.save(row);
    return { id };
  }

  async deleteVariable(id: string) {
    await this.assertEnabled();
    const result = await this.variable.delete({ id });
    if (!result.affected) {
      throw new AppError(404, "Expense not found", "VARIABLE_EXPENSE_NOT_FOUND");
    }
    return { id };
  }
}

export const adminExpensesService = new AdminExpensesService();
