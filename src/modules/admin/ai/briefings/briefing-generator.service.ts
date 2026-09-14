import { createChatCompletion } from "../../../../common/ai/openai-client.js";
import { logger } from "../../../../config/logger.js";
import { fallbackFromSnapshot } from "./briefing-fallback.js";
import type { BriefingSnapshot } from "./briefing-snapshot.service.js";

export type BriefingGeneratedContent = {
  title: string;
  summary: string;
  usedAi: boolean;
};

/**
 * Single OpenAI summarization call — no tool loop.
 */
export class AdminAiBriefingGenerator {
  async summarize(
    snapshot: BriefingSnapshot,
    userId: string,
  ): Promise<BriefingGeneratedContent> {
    const fallback = fallbackFromSnapshot(snapshot);
    try {
      const completion = await createChatCompletion(
        {
          messages: [
            {
              role: "system",
              content: [
                "You write a short operational morning briefing for school admins.",
                "Use ONLY the JSON metrics provided. Do not invent numbers.",
                "Do not suggest sending emails, changing data, or running tools.",
                "Return plain text with a first line title (max 80 chars), then a blank line, then 4-8 short bullet points.",
                "Each bullet must be a human-readable sentence like 'Attendance: 7 records this week (5 absent, 2 pending). Present or late rate is 0%.'",
                "Never paste raw JSON, field names, responseHint, or notes.",
                "Never include emails, phone numbers, passwords, tokens, or raw IDs.",
              ].join(" "),
            },
            {
              role: "user",
              content: JSON.stringify(snapshot),
            },
          ],
          temperature: 0.2,
          max_tokens: 700,
        },
        {
          feature: "admin_ai_briefing",
          userId,
          metadata: { sections: snapshot.sections.join(",") },
        },
      );

      const text = completion.choices[0]?.message?.content?.trim();
      if (!text) return fallback;
      if (looksLikeRawJsonDump(text)) return fallback;

      const [first, ...rest] = text.split("\n");
      const title = (first || "Morning briefing").replace(/^#+\s*/, "").slice(0, 120);
      const summary = rest.join("\n").trim() || text;
      return { title, summary: summary.slice(0, 8000), usedAi: true };
    } catch (error) {
      logger.warn({ err: error, userId }, "Briefing AI summarize failed; using fallback");
      return fallback;
    }
  }
}

function looksLikeRawJsonDump(text: string): boolean {
  return /[{[]/.test(text) && /"(startDate|openTaskCount|responseHint|ops_snapshot|byStatus)"/.test(text);
}

export const adminAiBriefingGenerator = new AdminAiBriefingGenerator();
