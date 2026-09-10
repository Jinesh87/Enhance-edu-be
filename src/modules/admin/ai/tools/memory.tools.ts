import type { AdminAiActor } from "../authorization.js";
import { adminAiMemoryService } from "../memory.js";
import { sanitizeToolPayload } from "../sanitize.js";
import type { ToolResult } from "../tool-helpers.js";

/**
 * Explicit "remember this" only. Never auto-save conversation content.
 */
export async function saveUserMemory(
  actor: AdminAiActor,
  args: { content?: string; kind?: string },
): Promise<ToolResult> {
  const content = args.content?.trim() ?? "";
  const result = await adminAiMemoryService.create(actor, {
    content,
    kind: args.kind,
  });

  return {
    data: sanitizeToolPayload({
      saved: true,
      kind: result.memory.kind,
      content: result.memory.content,
      responseHint:
        "Confirm briefly that the preference was saved. Do not invent extra memories. Remind the user they can manage memories in the Memories panel.",
    }),
    sources: [
      {
        kind: "database",
        label: "Scoped memory",
        detail: result.memory.kind,
      },
    ],
  };
}
