import { LessThan, In, IsNull } from "typeorm";
import { AppDataSource } from "../../../../config/data-source.js";
import { logger } from "../../../../config/logger.js";
import { UserRole, UserStatus } from "../../../../common/constants/roles.js";
import { AppError } from "../../../../common/errors/AppError.js";
import { AdminAiBriefing } from "../../../../entities/AdminAiBriefing.js";
import { User } from "../../../../entities/User.js";
import { notifyUsers } from "../../../notifications/domain-notifications.js";
import {
  assertCapabilityEnabled,
  loadAdminAiCapabilitySettings,
  type AdminAiBriefingSection,
} from "../admin-ai-capabilities.js";
import {
  resolveAdminAiActor,
  type AdminAiActor,
} from "../authorization.js";
import { adminAiBriefingGenerator } from "./briefing-generator.service.js";
import { localBriefingDateForRun } from "./briefing-schedule.js";
import { adminAiBriefingSnapshotService } from "./briefing-snapshot.service.js";

const RETENTION_DAYS = 90;

function stripBriefingMarkdown(value: string): string {
  return value
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatBriefingPhraseList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function buildBriefingNotificationBody(summary: string): string {
  const lines = summary
    .split(/\n+/)
    .map((line) => stripBriefingMarkdown(line.trim()))
    .filter(Boolean)
    .filter((line) => !/^here is your scheduled briefing/i.test(line));

  const phrases: string[] = [];
  for (const line of lines.slice(0, 4)) {
    const labeled =
      /^([^:—-]{2,40})\s*[:—-]\s*(.+)$/.exec(line) ??
      /^([^.]{2,40})\.\s+(.+)$/.exec(line);
    const label = (labeled?.[1] ?? "").toLowerCase();
    const detail = (labeled?.[2] ?? line).trim();
    const numMatch = detail.match(/\b(\d[\d,]*)\b/);
    if (!numMatch) continue;
    const count = Number(numMatch[1]!.replace(/,/g, ""));
    if (!Number.isFinite(count) || count <= 0) continue;

    if (label.includes("absence") || /\babsence/i.test(detail)) {
      phrases.push(`${count} absence${count === 1 ? "" : "s"}`);
      continue;
    }
    if (label.includes("task") || /\boverdue\b/i.test(detail)) {
      phrases.push(`${count} overdue task${count === 1 ? "" : "s"}`);
      continue;
    }
    if (label.includes("enquir") || /\benquir/i.test(detail)) {
      phrases.push(`${count} enquir${count === 1 ? "y" : "ies"}`);
      continue;
    }
    phrases.push(stripBriefingMarkdown(detail).slice(0, 48));
  }

  if (phrases.length > 0) {
    return `${formatBriefingPhraseList(phrases)} need attention.`;
  }

  const plain = stripBriefingMarkdown(summary);
  return plain.slice(0, 180) || "Your briefing is ready to review.";
}

export type AdminAiBriefingDto = {
  id: string;
  briefingDate: string;
  title: string;
  summary: string;
  readAt: string | null;
  createdAt: string;
  usedAi?: boolean;
};

function toDto(
  row: AdminAiBriefing,
  extra?: { usedAi?: boolean },
): AdminAiBriefingDto {
  return {
    id: row.id,
    briefingDate:
      typeof row.briefingDate === "string"
        ? row.briefingDate.slice(0, 10)
        : String(row.briefingDate).slice(0, 10),
    title: row.title,
    summary: row.summary,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    ...(extra?.usedAi !== undefined ? { usedAi: extra.usedAi } : {}),
  };
}

export class AdminAiBriefingService {
  private readonly repo = AppDataSource.getRepository(AdminAiBriefing);
  private readonly users = AppDataSource.getRepository(User);

  async listEligibleAdminUserIds(): Promise<string[]> {
    const rows = await this.users.find({
      where: {
        role: In([UserRole.SUPER_ADMIN, UserRole.OFFICE_STAFF]),
        status: UserStatus.ACTIVE,
      },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async listForUser(userId: string, limit = 10) {
    const take = Math.min(30, Math.max(1, limit));
    const rows = await this.repo.find({
      where: { userId },
      order: { briefingDate: "DESC", createdAt: "DESC" },
      take,
    });
    const unreadCount = await this.repo.count({
      where: { userId, readAt: IsNull() },
    });
    return {
      briefings: rows.map((row) => toDto(row)),
      unreadCount,
      latest: rows[0] ? toDto(rows[0]) : null,
    };
  }

  async markRead(userId: string, briefingId: string) {
    const row = await this.repo.findOne({ where: { id: briefingId, userId } });
    if (!row) {
      throw new AppError(404, "Briefing not found", "BRIEFING_NOT_FOUND");
    }
    if (!row.readAt) {
      row.readAt = new Date();
      await this.repo.save(row);
    }
    return toDto(row);
  }

  async deleteForUser(userId: string, briefingId: string) {
    const row = await this.repo.findOne({ where: { id: briefingId, userId } });
    if (!row) {
      throw new AppError(404, "Briefing not found", "BRIEFING_NOT_FOUND");
    }
    await this.repo.remove(row);
    return { id: briefingId };
  }

  async previewForActor(actor: AdminAiActor) {
    const settings = await loadAdminAiCapabilitySettings();
    assertCapabilityEnabled(settings, "proactiveBriefing");
    const sections = settings.briefingConfig.sections;
    const snapshot = await adminAiBriefingSnapshotService.collect(
      actor,
      sections,
    );
    const generated = await adminAiBriefingGenerator.summarize(
      snapshot,
      actor.id,
    );
    return {
      title: generated.title,
      summary: generated.summary,
      usedAi: generated.usedAi,
      briefingDate: localBriefingDateForRun(
        new Date(),
        settings.briefingConfig.timeZone,
      ),
      snapshot,
    };
  }

  /**
   * Idempotent generate+persist for one user/localDate.
   * Returns null when a row already exists.
   */
  async generateForUser(input: {
    userId: string;
    briefingDate: string;
    sections: AdminAiBriefingSection[];
    timeZone: string;
    notify: boolean;
  }): Promise<AdminAiBriefingDto | null> {
    const existing = await this.repo.findOne({
      where: { userId: input.userId, briefingDate: input.briefingDate },
    });
    if (existing) return null;

    const settings = await loadAdminAiCapabilitySettings();
    if (!settings.proactiveBriefingEnabled) {
      logger.info({ userId: input.userId }, "Briefing skipped: capability off");
      return null;
    }

    let actor: AdminAiActor;
    try {
      actor = await resolveAdminAiActor(input.userId);
    } catch (error) {
      logger.warn({ err: error, userId: input.userId }, "Briefing actor denied");
      return null;
    }

    const snapshot = await adminAiBriefingSnapshotService.collect(
      actor,
      input.sections,
    );
    const generated = await adminAiBriefingGenerator.summarize(
      snapshot,
      actor.id,
    );

    const row = this.repo.create({
      userId: input.userId,
      briefingDate: input.briefingDate,
      title: generated.title.slice(0, 200),
      summary: generated.summary,
      snapshot: snapshot as unknown as Record<string, unknown>,
      readAt: null,
    });

    try {
      const saved = await this.repo.save(row);
      if (input.notify) {
        await notifyUsers([
          {
            userId: input.userId,
            type: "ADMIN_AI_BRIEFING",
            title: "Morning briefing ready",
            body: buildBriefingNotificationBody(saved.summary),
            data: {
              briefingId: saved.id,
              briefingDate: input.briefingDate,
              href: "/admin",
            },
          },
        ]);
      }
      return toDto(saved, { usedAi: generated.usedAi });
    } catch (error) {
      // Unique violation → another worker won; treat as success/no-op.
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: string }).code)
          : "";
      if (code === "23505") {
        logger.info(
          { userId: input.userId, briefingDate: input.briefingDate },
          "Briefing duplicate ignored",
        );
        return null;
      }
      throw error;
    }
  }

  async purgeOlderThanRetention(): Promise<number> {
    const cutoff = new Date(
      Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    const result = await this.repo.delete({ createdAt: LessThan(cutoff) });
    return result.affected ?? 0;
  }
}

export const adminAiBriefingService = new AdminAiBriefingService();
