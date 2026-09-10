import type { AdminAiActor } from "../authorization.js";
import { adminAiReportService } from "../reports/report.service.js";
import { sanitizeToolPayload } from "../sanitize.js";
import { generateReportAction, type ToolResult } from "../tool-helpers.js";

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

function previewToolResult(
  preview: Awaited<ReturnType<typeof adminAiReportService.preview>>,
): ToolResult {
  const table = markdownTable(preview.columns, preview.rows);
  const filterLine = preview.filterLabels.length
    ? preview.filterLabels.join(" · ")
    : "No extra filters";

  return {
    data: sanitizeToolPayload({
      draftId: preview.draftId,
      reportType: preview.reportType,
      title: preview.title,
      filtersApplied: filterLine,
      summary: preview.summary,
      columns: preview.columns,
      previewRowCount: preview.previewRowCount,
      totalMatched: preview.totalMatched,
      truncated: preview.truncated,
      markdownTable: table,
      responseHint: [
        "Render the report preview in chat using the markdownTable exactly.",
        "Include title, filtersApplied, and summary bullets.",
        `If truncated, say Showing ${preview.previewRowCount} of ${preview.totalMatched} records.`,
        "Do NOT say the PDF is ready yet.",
        "Tell the user they can ask to adjust filters/columns, then click Generate PDF.",
        "Never invent rows or URLs.",
      ].join(" "),
    }),
    sources: [
      {
        kind: "database",
        label: "Report preview",
        detail: preview.reportType,
      },
    ],
    actions: [generateReportAction(preview.draftId, "Generate PDF")],
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
