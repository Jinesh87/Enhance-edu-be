import { createChatCompletion } from "../../../../common/ai/openai-client.js";
import { logger } from "../../../../config/logger.js";
import type { BriefingSnapshot } from "./briefing-snapshot.service.js";

export type BriefingGeneratedContent = {
  title: string;
  summary: string;
  usedAi: boolean;
};

function fallbackFromSnapshot(snapshot: BriefingSnapshot): BriefingGeneratedContent {
  const lines: string[] = [];
  for (const section of snapshot.sections) {
    const payload = snapshot.data[section];
    if (!payload || typeof payload !== "object") continue;
    const json = JSON.stringify(payload);
    lines.push(`• ${section}: ${json.slice(0, 220)}`);
  }
  return {
    title: "Morning briefing",
    summary:
      lines.length > 0
        ? ["Here is your scheduled briefing (fallback summary):", ...lines].join(
            "\n",
          )
        : "No briefing metrics were available for the selected sections.",
    usedAi: false,
  };
}

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

export const adminAiBriefingGenerator = new AdminAiBriefingGenerator();
