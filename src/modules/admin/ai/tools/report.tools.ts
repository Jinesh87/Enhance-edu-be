import type { AdminAiActor } from "../authorization.js";
import { adminAiReportService } from "../reports/report.service.js";
import { sanitizeToolPayload } from "../sanitize.js";
import {
  adjustReportAction,
  generateReportAction,
  type ToolResult,
} from "../tool-helpers.js";

function markdownTable(columns: string[], rows: string[][]): string {
  if (!columns.length) return "";
  const header = `| ${columns.join(" | ")} |`;
  const sep = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows
    .map(
      (row) =>
        `| ${row.map((cell) => String(cell ?? "—").replace(/\|/g, "/")).join(" | ")} |`,
    )
    .join("\n");
  return `${header}\n${sep}\n${body}`;
}

type PreviewResult = Awaited<ReturnType<typeof adminAiReportService.preview>> & {
  blockedColumns?: string[];
  unavailableColumns?: string[];
};

function previewToolResult(preview: PreviewResult): ToolResult {
  const table = markdownTable(preview.columns, preview.rows);
  const filterLine = preview.filterLabels.length
    ? preview.filterLabels.join(" · ")
    : "No extra filters";
  const summaryLines = preview.summary.length
    ? preview.summary.map((item) => `${item.label}: ${item.value}`).join("; ")
    : "No summary metrics";
  const available = preview.availableColumns?.length
    ? preview.availableColumns
    : preview.columns;
  const blocked = preview.blockedColumns ?? [];
  const unavailable = preview.unavailableColumns ?? [];

  const adjustmentNotes: string[] = [];
  if (blocked.length) {
    adjustmentNotes.push(
      `Sensitive fields were refused and cannot be added to reports/PDFs: ${blocked.join(", ")}. Never include email, phone, password, fee, address, or DOB.`,
    );
  }
  if (unavailable.length) {
    adjustmentNotes.push(
      `These columns are not available for this report: ${unavailable.join(", ")}. Use only availableColumns.`,
    );
  }

  return {
    data: sanitizeToolPayload({
      draftId: preview.draftId,
      reportType: preview.reportType,
      title: preview.title,
      filtersApplied: filterLine,
      summary: preview.summary,
      summaryText: summaryLines,
      columns: preview.columns,
      availableColumns: available,
      previewRowCount: preview.previewRowCount,
      totalMatched: preview.totalMatched,
      truncated: preview.truncated,
      markdownTable: table,
      blockedColumns: blocked.length ? blocked : null,
      unavailableColumns: unavailable.length ? unavailable : null,
      responseHint: [
        "This is a report PREVIEW only — no PDF has been created yet.",
        "Reply structure (required):",
        `1) Title line: **${preview.title}**`,
        `2) Filters: ${filterLine}`,
        `3) Summary: ${summaryLines}`,
        "4) The markdownTable exactly (do not invent or drop rows).",
        preview.truncated
          ? `5) Note: Showing ${preview.previewRowCount} of ${preview.totalMatched} records.`
          : "",
        `6) Safe columns you may add/remove via updateReportPreview: ${available.join(", ")}.`,
        "7) Never add email, phone, password, fee, address, or other sensitive fields.",
        ...adjustmentNotes.map((note, index) => `${8 + index}) ${note}`),
        "Say the user can click Adjust preview (or reply with changes), then click Generate PDF when ready.",
        "Never invent rows, URLs, file paths, or claim the PDF is ready.",
        `Keep draftId ${preview.draftId} for any updateReportPreview call.`,
      ]
        .filter(Boolean)
        .join(" "),
    }),
    sources: [
      {
        kind: "database",
        label: "Report preview",
        detail: preview.reportType,
      },
    ],
    actions: [
      adjustReportAction(preview.draftId, "Adjust preview"),
      generateReportAction(preview.draftId, "Generate PDF"),
    ],
  };
}

/** Structured report preview only — no PDF until Generate PDF is confirmed. */
export async function previewReport(
  actor: AdminAiActor,
  args: {
    reportType?: string;
    filters?: Record<string, unknown>;
    columns?: string[];
    draftId?: string;
  },
): Promise<ToolResult> {
  const preview = await adminAiReportService.preview(actor, {
    reportType: args.reportType ?? "",
    filters: args.filters ?? null,
    columns: args.columns ?? null,
    draftId: args.draftId ?? null,
  });
  return previewToolResult(preview);
}

/** Adjust draft filters/columns and return a fresh preview. */
export async function updateReportPreview(
  actor: AdminAiActor,
  args: {
    draftId?: string;
    reportType?: string;
    filters?: Record<string, unknown>;
    columns?: string[];
    addColumns?: string[];
    removeColumns?: string[];
  },
): Promise<ToolResult> {
  if (!args.draftId?.trim()) {
    return {
      data: sanitizeToolPayload({
        error: "No report draft to adjust. Preview a report first.",
        responseHint: "Ask the user to request a report preview first.",
      }),
      sources: [],
    };
  }

  const preview = await adminAiReportService.updatePreview(actor, {
    draftId: args.draftId,
    reportType: args.reportType,
    filters: args.filters ?? null,
    columns: args.columns ?? null,
    addColumns: args.addColumns ?? null,
    removeColumns: args.removeColumns ?? null,
  });
  return previewToolResult(preview);
}

/**
 * Legacy tool name: now previews only (does not create a PDF).
 */
export async function generateReport(
  actor: AdminAiActor,
  args: {
    reportType?: string;
    format?: string;
    filters?: Record<string, unknown>;
  },
): Promise<ToolResult> {
  void args.format;
  return previewReport(actor, {
    reportType: args.reportType,
    filters: args.filters,
  });
}
