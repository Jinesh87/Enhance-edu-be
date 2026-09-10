import { randomUUID } from "crypto";
import type { Response } from "express";
import { UserRole } from "../../../../common/constants/roles.js";
import { AppError } from "../../../../common/errors/AppError.js";
import { AppDataSource } from "../../../../config/data-source.js";
import { AdminAiReport } from "../../../../entities/AdminAiReport.js";
import { AdminAiReportDraft } from "../../../../entities/AdminAiReportDraft.js";
import {
  DEFAULT_CLASS_TIMEZONE,
  formatInTimeZone,
} from "../../../../common/utils/timezone.js";
import { writeAdminAiAudit } from "../audit.js";
import type { AdminAiActor } from "../authorization.js";
import { adminAiReportRepository } from "./report.repository.js";
import { adminAiReportStorageService } from "./report-storage.service.js";
import { renderAdminAiReportPdf } from "./report.templates.js";
import {
  isAdminAiReportType,
  REPORT_MODULE,
  REPORT_PREVIEW_ROWS,
  reportTypeLabel,
  type AdminAiReportFilters,
  type AdminAiReportType,
  type ReportTablePayload,
} from "./report.types.js";

function assertReportModuleAccess(
  actor: AdminAiActor,
  reportType: AdminAiReportType,
) {
  if (actor.role === UserRole.SUPER_ADMIN) return;
  if (actor.role !== UserRole.OFFICE_STAFF) {
    throw new AppError(
      403,
      "You do not have permission to access this information.",
      "ADMIN_AI_MODULE_FORBIDDEN",
    );
  }
  const moduleId = REPORT_MODULE[reportType];
  if (!actor.modulePermissions.includes(moduleId)) {
    throw new AppError(
      403,
      "You do not have permission to access this information.",
      "ADMIN_AI_MODULE_FORBIDDEN",
    );
  }
}

function sanitizeFilters(
  raw: Record<string, unknown> | null | undefined,
): AdminAiReportFilters {
  const asString = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : null;
  const asNumber = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value)
      ? value
      : typeof value === "string" && value.trim() && Number.isFinite(Number(value))
        ? Number(value)
        : null;

  return {
    startDate: asString(raw?.startDate),
    endDate: asString(raw?.endDate),
    yearLevel: asString(raw?.yearLevel),
    term: asString(raw?.term),
    subject: asString(raw?.subject),
    threshold: asNumber(raw?.threshold),
    status: asString(raw?.status),
    academicYear: asString(raw?.academicYear),
  };
}

function mergeFilters(
  current: AdminAiReportFilters,
  patch: Record<string, unknown> | null | undefined,
): AdminAiReportFilters {
  const next = sanitizeFilters(patch);
  return {
    startDate: next.startDate ?? current.startDate ?? null,
    endDate: next.endDate ?? current.endDate ?? null,
    yearLevel: next.yearLevel ?? current.yearLevel ?? null,
    term: next.term ?? current.term ?? null,
    subject: next.subject ?? current.subject ?? null,
    threshold: next.threshold ?? current.threshold ?? null,
    status: next.status ?? current.status ?? null,
    academicYear: next.academicYear ?? current.academicYear ?? null,
  };
}

function safeFileName(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "enhance-report"}.pdf`;
}

function normalizePayload(payload: ReportTablePayload, title: string): ReportTablePayload {
  if (payload.rows.length === 0) {
    return {
      ...payload,
      title,
      columns: ["Message"],
      rows: [["No matching records for the selected filters."]],
      totalMatched: 0,
    };
  }
  return { ...payload, title, totalMatched: payload.totalMatched ?? payload.rows.length };
}

function applyColumnSelection(
  payload: ReportTablePayload,
  selected: string[] | null | undefined,
): ReportTablePayload {
  if (!selected?.length) return payload;
  const wanted = selected.map((c) => c.trim().toLowerCase()).filter(Boolean);
  if (!wanted.length) return payload;

  const indexes: number[] = [];
  const columns: string[] = [];
  payload.columns.forEach((col, index) => {
    if (wanted.includes(col.toLowerCase())) {
      indexes.push(index);
      columns.push(col);
    }
  });
  if (!columns.length) return payload;

  return {
    ...payload,
    columns,
    rows: payload.rows.map((row) => indexes.map((i) => row[i] ?? "—")),
  };
}

function toPreviewSlice(payload: ReportTablePayload) {
  const totalMatched = payload.totalMatched ?? payload.rows.length;
  const previewRows = payload.rows.slice(0, REPORT_PREVIEW_ROWS);
  return {
    title: payload.title,
    filterLabels: payload.filterLabels,
    summary: payload.summary,
    columns: payload.columns,
    rows: previewRows,
    previewRowCount: previewRows.length,
    totalMatched,
    truncated: totalMatched > previewRows.length || payload.truncated,
  };
}

export class AdminAiReportService {
  private readonly reports = AppDataSource.getRepository(AdminAiReport);
  private readonly drafts = AppDataSource.getRepository(AdminAiReportDraft);

  private async loadPayload(
    reportType: AdminAiReportType,
    filters: AdminAiReportFilters,
    columns: string[] | null,
  ): Promise<ReportTablePayload> {
    const raw = await adminAiReportRepository.buildPayload(reportType, filters);
    const titled = normalizePayload(raw, reportTypeLabel(reportType));
    return applyColumnSelection(titled, columns);
  }

  async preview(
    actor: AdminAiActor,
    input: {
      reportType: string;
      filters?: Record<string, unknown> | null;
      columns?: string[] | null;
      threadId?: string | null;
      draftId?: string | null;
    },
  ) {
    const reportTypeRaw = input.reportType?.trim().toUpperCase() ?? "";
    if (!isAdminAiReportType(reportTypeRaw)) {
      throw new AppError(
        400,
        "That report type is not available.",
        "ADMIN_AI_REPORT_TYPE_INVALID",
      );
    }
    const reportType = reportTypeRaw;
    assertReportModuleAccess(actor, reportType);

    let draft: AdminAiReportDraft | null = null;
    if (input.draftId) {
      draft = await this.drafts.findOne({
        where: { id: input.draftId, ownerUserId: actor.id },
      });
    }

    const filters = draft
      ? mergeFilters(sanitizeFilters(draft.filters), input.filters)
      : sanitizeFilters(input.filters);
    const columns =
      input.columns?.map((c) => c.trim()).filter(Boolean).slice(0, 12) ??
      draft?.columns ??
      null;
    const title = reportTypeLabel(reportType);
    const payload = await this.loadPayload(reportType, filters, columns);
    const preview = toPreviewSlice(payload);

    if (draft) {
      draft.reportType = reportType;
      draft.filters = filters;
      draft.columns = columns;
      draft.title = title;
      draft.threadId = input.threadId ?? draft.threadId;
      await this.drafts.save(draft);
    } else {
      draft = await this.drafts.save(
        this.drafts.create({
          ownerUserId: actor.id,
          threadId: input.threadId ?? null,
          reportType,
          filters,
          columns,
          title,
        }),
      );
    }

    await writeAdminAiAudit({
      requestId: randomUUID().replace(/-/g, "").slice(0, 32),
      actor,
      conversationId: draft.threadId,
      eventType: "AI_REPORT_PREVIEWED",
      scopeMetadata: {
        draftId: draft.id,
        reportType,
        filters,
        previewRowCount: preview.previewRowCount,
        totalMatched: preview.totalMatched,
      },
      resultStatus: "ok",
    });

    return {
      draftId: draft.id,
      reportType,
      filters,
      ...preview,
      title,
    };
  }

  async updatePreview(
    actor: AdminAiActor,
    input: {
      draftId: string;
      reportType?: string | null;
      filters?: Record<string, unknown> | null;
      columns?: string[] | null;
      removeColumns?: string[] | null;
      addColumns?: string[] | null;
    },
  ) {
    const draft = await this.drafts.findOne({
      where: { id: input.draftId, ownerUserId: actor.id },
    });
    if (!draft) {
      throw new AppError(404, "Report draft not found", "ADMIN_AI_REPORT_DRAFT_NOT_FOUND");
    }

    const reportTypeRaw =
      input.reportType?.trim().toUpperCase() || draft.reportType;
    if (!isAdminAiReportType(reportTypeRaw)) {
      throw new AppError(
        400,
        "That report type is not available.",
        "ADMIN_AI_REPORT_TYPE_INVALID",
      );
    }
    assertReportModuleAccess(actor, reportTypeRaw);

    const filters = mergeFilters(sanitizeFilters(draft.filters), input.filters);
    let columns = draft.columns;

    if (input.columns?.length) {
      columns = input.columns.map((c) => c.trim()).filter(Boolean).slice(0, 12);
    } else {
      const payload = await this.loadPayload(
        reportTypeRaw,
        filters,
        null,
      );
      let next = columns?.length ? [...columns] : [...payload.columns];
      if (input.removeColumns?.length) {
        const remove = new Set(
          input.removeColumns.map((c) => c.trim().toLowerCase()),
        );
        next = next.filter((c) => !remove.has(c.toLowerCase()));
      }
      if (input.addColumns?.length) {
        for (const col of input.addColumns) {
          const match = payload.columns.find(
            (c) => c.toLowerCase() === col.trim().toLowerCase(),
          );
          if (match && !next.some((c) => c.toLowerCase() === match.toLowerCase())) {
            next.push(match);
          }
        }
      }
      columns = next.slice(0, 12);
    }

    return this.preview(actor, {
      draftId: draft.id,
      reportType: reportTypeRaw,
      filters,
      columns,
      threadId: draft.threadId,
    });
  }

  async confirmGenerate(actor: AdminAiActor, draftId: string) {
    const draft = await this.drafts.findOne({
      where: { id: draftId, ownerUserId: actor.id },
    });
    if (!draft) {
      throw new AppError(404, "Report draft not found", "ADMIN_AI_REPORT_DRAFT_NOT_FOUND");
    }
    if (!isAdminAiReportType(draft.reportType)) {
      throw new AppError(
        400,
        "That report type is not available.",
        "ADMIN_AI_REPORT_TYPE_INVALID",
      );
    }

    const reportType = draft.reportType;
    assertReportModuleAccess(actor, reportType);
    const filters = sanitizeFilters(draft.filters);
    const title = draft.title || reportTypeLabel(reportType);
    const requestId = randomUUID().replace(/-/g, "").slice(0, 32);

    try {
      // Fresh fetch at confirm time — do not reuse stale preview rows.
      const payload = await this.loadPayload(reportType, filters, draft.columns);

      const generatedAtLabel = formatInTimeZone(
        new Date(),
        DEFAULT_CLASS_TIMEZONE,
        {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
        },
      );

      const buffer = renderAdminAiReportPdf({
        institutionName: "Enhance Education",
        generatedAtLabel,
        payload: { ...payload, title },
      });

      const reportId = randomUUID();
      const fileName = safeFileName(title);
      const stored = await adminAiReportStorageService.storePdf({
        ownerUserId: actor.id,
        reportId,
        buffer,
      });

      const report = await this.reports.save(
        this.reports.create({
          id: reportId,
          ownerUserId: actor.id,
          reportType,
          format: "PDF",
          filters,
          title,
          storageKey: stored.storageKey,
          fileName,
          byteSize: stored.byteSize,
          status: "READY",
        }),
      );

      await writeAdminAiAudit({
        requestId,
        actor,
        conversationId: draft.threadId,
        eventType: "AI_REPORT_GENERATED",
        scopeMetadata: {
          reportId: report.id,
          draftId: draft.id,
          reportType,
          format: "PDF",
          filters,
          byteSize: stored.byteSize,
        },
        resultStatus: "ok",
      });

      return {
        reportId: report.id,
        title: report.title,
        reportType,
        rowCount: payload.rows.length,
        truncated: payload.truncated,
        fileName,
      };
    } catch (error) {
      if (error instanceof AppError) {
        await writeAdminAiAudit({
          requestId,
          actor,
          eventType: "AI_REPORT_FAILED",
          scopeMetadata: {
            draftId: draft.id,
            reportType,
            filters,
            errorCode: error.code,
          },
          resultStatus: "failed",
          errorCode: error.code,
        });
        throw error;
      }
      await writeAdminAiAudit({
        requestId,
        actor,
        eventType: "AI_REPORT_FAILED",
        scopeMetadata: { draftId: draft.id, reportType, filters },
        resultStatus: "failed",
        errorCode: "ADMIN_AI_REPORT_FAILED",
      });
      throw new AppError(
        503,
        "Unable to generate this report right now. Please try again.",
        "ADMIN_AI_REPORT_FAILED",
      );
    }
  }

  async downloadForOwner(
    actor: AdminAiActor,
    reportId: string,
    res: Response,
  ): Promise<void> {
    const report = await this.reports.findOne({
      where: { id: reportId, ownerUserId: actor.id, status: "READY" },
    });
    if (!report?.storageKey || !report.fileName) {
      throw new AppError(404, "Report not found", "ADMIN_AI_REPORT_NOT_FOUND");
    }

    if (!isAdminAiReportType(report.reportType)) {
      throw new AppError(404, "Report not found", "ADMIN_AI_REPORT_NOT_FOUND");
    }
    assertReportModuleAccess(actor, report.reportType);

    const buffer = await adminAiReportStorageService.getDownloadBuffer(
      report.storageKey,
    );

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(report.fileName)}"`,
    );
    res.setHeader("Cache-Control", "private, max-age=60");
    res.status(200).send(buffer);
  }
}

export const adminAiReportService = new AdminAiReportService();
