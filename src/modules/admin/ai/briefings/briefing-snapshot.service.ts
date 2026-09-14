import type { AdminAiActor } from "../authorization.js";
import type { AdminAiBriefingSection } from "../admin-ai-capabilities.js";
import { sanitizeToolPayload } from "../sanitize.js";
import {
  getAttendanceSummary,
  getEnquiryPipelineSummary,
  getOpenTasksSummary,
  getOpsSnapshot,
  getPendingHomeworkSummary,
} from "../tool-services.js";

export type BriefingSnapshot = {
  asOf: string;
  sections: AdminAiBriefingSection[];
  data: Record<string, unknown>;
};

/**
 * Collects read-only aggregates for selected briefing sections.
 * AI must only summarize this payload — never invent tools/SQL/actions.
 */
export class AdminAiBriefingSnapshotService {
  async collect(
    actor: AdminAiActor,
    sections: AdminAiBriefingSection[],
  ): Promise<BriefingSnapshot> {
    const unique = [...new Set(sections)];
    const tasks: Array<Promise<void>> = [];
    const data: Record<string, unknown> = {};

    const run = (
      key: AdminAiBriefingSection,
      fn: () => Promise<{ data: unknown }>,
    ) => {
      if (!unique.includes(key)) return;
      tasks.push(
        (async () => {
          try {
            const result = await fn();
            data[key] = sanitizeToolPayload(result.data);
          } catch (error) {
            data[key] = {
              error: "unavailable",
              message:
                error instanceof Error ? error.message.slice(0, 120) : "error",
            };
          }
        })(),
      );
    };

    run("attendance", () => getAttendanceSummary(actor, {}));
    run("tasks", () => getOpenTasksSummary(actor));
    run("enquiries", () => getEnquiryPipelineSummary(actor));
    run("homework", () => getPendingHomeworkSummary(actor, {}));
    run("operations", () => getOpsSnapshot(actor));

    await Promise.all(tasks);

    return {
      asOf: new Date().toISOString(),
      sections: unique,
      data: sanitizeToolPayload(data) as Record<string, unknown>,
    };
  }
}

export const adminAiBriefingSnapshotService =
  new AdminAiBriefingSnapshotService();
