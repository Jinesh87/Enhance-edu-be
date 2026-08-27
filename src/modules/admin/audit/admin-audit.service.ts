import { Between, ILike, type FindOptionsWhere } from "typeorm";
import { AppDataSource } from "../../../config/data-source.js";
import {
  DEFAULT_CLASS_TIMEZONE,
  zonedWallTimeToUtc,
} from "../../../common/utils/timezone.js";
import { writeAuditLog } from "../../../common/utils/audit-log.js";
import {
  AuditChange,
  type AuditAction,
} from "../../../entities/AuditChange.js";

export type ListAuditFilters = {
  page?: number;
  limit?: number;
  actor?: string;
  recordType?: string;
  record?: string;
  action?: AuditAction;
  from?: string;
  to?: string;
  search?: string;
};

function parseDayBound(value: string, endOfDay: boolean): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return zonedWallTimeToUtc(
    {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: endOfDay ? 23 : 0,
      minute: endOfDay ? 59 : 0,
      second: endOfDay ? 59 : 0,
    },
    DEFAULT_CLASS_TIMEZONE,
  );
}

function toDto(row: AuditChange) {
  return {
    id: row.id,
    reference: row.reference,
    actorKind: row.actorKind,
    actorUserId: row.actorUserId,
    actorName: row.actorName,
    action: row.action,
    recordType: row.recordType,
    recordId: row.recordId,
    recordLabel: row.recordLabel,
    recordPath: row.recordPath,
    before: row.before,
    after: row.after,
    createdAt: row.createdAt,
  };
}

export class AdminAuditService {
  private readonly logs = AppDataSource.getRepository(AuditChange);

  async list(filters: ListAuditFilters) {
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const limit =
      filters.limit && filters.limit > 0 ? Math.min(filters.limit, 100) : 20;

    const where: FindOptionsWhere<AuditChange> = {};
    if (filters.action) where.action = filters.action;
    if (filters.recordType) where.recordType = filters.recordType;
    if (filters.actor) where.actorName = ILike(`%${filters.actor.trim()}%`);

    const from = filters.from ? parseDayBound(filters.from, false) : null;
    const to = filters.to ? parseDayBound(filters.to, true) : null;
    if (from && to) where.createdAt = Between(from, to);
    else if (from) where.createdAt = Between(from, new Date("9999-12-31"));
    else if (to) where.createdAt = Between(new Date("1970-01-01"), to);

    const search = filters.search?.trim() || filters.record?.trim();
    const findOptions: {
      where: FindOptionsWhere<AuditChange> | FindOptionsWhere<AuditChange>[];
      order: { createdAt: "DESC" };
      skip: number;
      take: number;
    } = {
      where,
      order: { createdAt: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    };

    if (search) {
      findOptions.where = [
        { ...where, recordLabel: ILike(`%${search}%`) },
        { ...where, reference: ILike(`%${search}%`) },
        { ...where, recordId: ILike(`%${search}%`) },
      ];
    }

    const [rows, total] = await this.logs.findAndCount(findOptions);

    const actorRows = await this.logs
      .createQueryBuilder("log")
      .select("DISTINCT log.actorName", "actorName")
      .orderBy("log.actorName", "ASC")
      .getRawMany<{ actorName: string }>();

    const typeRows = await this.logs
      .createQueryBuilder("log")
      .select("DISTINCT log.recordType", "recordType")
      .orderBy("log.recordType", "ASC")
      .getRawMany<{ recordType: string }>();

    return {
      entries: rows.map(toDto),
      total,
      page,
      limit,
      actors: actorRows.map((row) => row.actorName).filter(Boolean),
      recordTypes: typeRows.map((row) => row.recordType).filter(Boolean),
    };
  }

  async exportCsv(filters: ListAuditFilters, actorUserId: string) {
    const data = await this.list({ ...filters, page: 1, limit: 5000 });
    const header = [
      "Reference",
      "Who",
      "What",
      "Record type",
      "Which record",
      "When (Sydney)",
      "Before",
      "After",
    ];
    const lines = [header.join(",")];
    for (const entry of data.entries) {
      const when = new Date(entry.createdAt).toLocaleString("en-AU", {
    timeZone: DEFAULT_CLASS_TIMEZONE,
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      lines.push(
        [
          csvCell(entry.reference),
          csvCell(entry.actorName),
          csvCell(entry.action),
          csvCell(entry.recordType),
          csvCell(entry.recordLabel),
          csvCell(when),
          csvCell(entry.before ? JSON.stringify(entry.before) : ""),
          csvCell(entry.after ? JSON.stringify(entry.after) : ""),
        ].join(","),
      );
    }

    await writeAuditLog({
      actorUserId,
      action: "EXPORTED",
      recordType: "change_history",
      recordLabel: "Change history export",
      after: {
        rows: data.entries.length,
        action: filters.action ?? null,
        recordType: filters.recordType ?? null,
      },
    });

    const stamp = new Date().toISOString().slice(0, 10);
    return {
      fileName: `change-history-${stamp}.csv`,
      csv: lines.join("\n"),
    };
  }
}

function csvCell(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

export const adminAuditService = new AdminAuditService();
