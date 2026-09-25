import { AppError } from "../../../common/errors/AppError.js";
import { settingsService } from "../../settings/settings.service.js";
import { dayBoundsInClassTz } from "../ai/tool-helpers.js";
import { adminExpensesService } from "../expenses/admin-expenses.service.js";
import { adminPayrollService } from "../payroll/admin-payroll.service.js";
import { adminStaffPayrollService } from "../payroll/admin-staff-payroll.service.js";

export type FinancePeriodQuery = {
  from?: string;
  to?: string;
  detailed?: boolean;
};

function parseYmd(value?: string) {
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

class AdminFinanceService {
  /**
   * Combined cost overview for one period. Each section is null when its
   * feature is disabled. With `detailed`, every session, work entry and
   * expense charge is included.
   */
  async overview(query: FinancePeriodQuery) {
    const today = dayBoundsInClassTz().label;
    const from = parseYmd(query.from) ?? `${today.slice(0, 8)}01`;
    const to = parseYmd(query.to) ?? today;
    if (from > to) {
      throw new AppError(400, "Period start must be on or before period end", "INVALID_PERIOD");
    }
    const period = { from, to };
    const detailed = Boolean(query.detailed);

    const [payrollEnabled, expensesEnabled] = await Promise.all([
      settingsService.isTeacherPayrollEnabled(),
      settingsService.isExpensesEnabled(),
    ]);

    const [teacherList, staffList, expenses] = await Promise.all([
      payrollEnabled
        ? adminPayrollService.list(period, { includeSessions: detailed })
        : null,
      payrollEnabled
        ? adminStaffPayrollService.list(period, { includeEntries: detailed })
        : null,
      expensesEnabled ? adminExpensesService.overview(period) : null,
    ]);

    const teacherPay = teacherList
      ? {
          total: roundMoney(
            teacherList.items.reduce((sum, t) => sum + (t.summary.amount ?? 0), 0),
          ),
          sessions: teacherList.items.reduce((sum, t) => sum + t.summary.sessionCount, 0),
          hours: roundMoney(
            teacherList.items.reduce((sum, t) => sum + t.summary.totalHours, 0),
          ),
          paidCount: teacherList.items.filter((t) => t.config?.isActive).length,
          items: teacherList.items.filter((t) => (t.summary.amount ?? 0) > 0),
        }
      : null;

    const staffPay = staffList
      ? {
          total: roundMoney(
            staffList.items.reduce((sum, s) => sum + (s.summary.amount ?? 0), 0),
          ),
          entries: staffList.items.reduce((sum, s) => sum + s.summary.entryCount, 0),
          hours: roundMoney(staffList.items.reduce((sum, s) => sum + s.summary.totalHours, 0)),
          days: roundMoney(staffList.items.reduce((sum, s) => sum + s.summary.totalDays, 0)),
          paidCount: staffList.items.filter((s) => s.config?.isActive).length,
          items: staffList.items.filter((s) => (s.summary.amount ?? 0) > 0),
        }
      : null;

    const expenseSection = expenses
      ? {
          total: expenses.summary.total,
          fixedTotal: expenses.summary.fixedTotal,
          variableTotal: expenses.summary.variableTotal,
          fixedOccurrences: expenses.summary.fixedOccurrences,
          variableCount: expenses.summary.variableCount,
          byCategory: expenses.byCategory,
          ...(detailed ? { ledger: expenses.ledger } : {}),
        }
      : null;

    const breakdown = [
      ...(teacherPay ? [{ key: "teacher-pay", label: "Teacher pay", group: "Payroll", amount: teacherPay.total }] : []),
      ...(staffPay ? [{ key: "staff-pay", label: "Staff pay", group: "Payroll", amount: staffPay.total }] : []),
      ...(expenseSection
        ? expenseSection.byCategory.map((c) => ({
            key: `expense:${c.category}`,
            label: c.category,
            group: "Expenses",
            amount: c.amount,
          }))
        : []),
    ];

    const grandTotal = roundMoney(breakdown.reduce((sum, row) => sum + row.amount, 0));

    return {
      period,
      currency: expenses?.summary.currency ?? "AUD",
      enabled: { payroll: payrollEnabled, expenses: expensesEnabled },
      totals: {
        grandTotal,
        payroll: roundMoney((teacherPay?.total ?? 0) + (staffPay?.total ?? 0)),
        expenses: expenseSection?.total ?? 0,
      },
      breakdown,
      teacherPay,
      staffPay,
      expenses: expenseSection,
    };
  }
}

export const adminFinanceService = new AdminFinanceService();
