import crypto from "crypto";
import { AppDataSource } from "../../config/data-source.js";
import { logger } from "../../config/logger.js";
import {
  AuditChange,
  type AuditAction,
  type AuditActorKind,
} from "../../entities/AuditChange.js";
import { User } from "../../entities/User.js";

export type WriteAuditLogInput = {
  actorUserId?: string | null;
  actorName?: string | null;
  actorKind?: AuditActorKind;
  action: AuditAction;
  recordType: string;
  recordId?: string | null;
  recordLabel: string;
  recordPath?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

const RECORD_PATHS: Record<string, (id: string) => string> = {
  person: (id) => `/admin/people/${id}`,
  enrolment: (id) => `/admin/enrolments/${id}`,
  class: () => `/admin/classes`,
  subject: () => `/admin/subjects`,
  term: () => `/admin/terms`,
  account: () => "/admin/people",
  change_history: () => "/admin/change-history",
};

export function recordPathFor(
  recordType: string,
  recordId?: string | null,
): string | null {
  const builder = RECORD_PATHS[recordType];
  if (!builder) return null;
  return builder(recordId ?? "");
}

export function changedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): {
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
} {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const beforeOut: Record<string, unknown> = {};
  const afterOut: Record<string, unknown> = {};

  for (const key of keys) {
    if (JSON.stringify(before[key] ?? null) === JSON.stringify(after[key] ?? null)) {
      continue;
    }
    beforeOut[key] = before[key] ?? null;
    afterOut[key] = after[key] ?? null;
  }

  const hasChanges = Object.keys(beforeOut).length > 0;
  return {
    before: hasChanges ? beforeOut : null,
    after: hasChanges ? afterOut : null,
  };
}

function makeReference() {
  return `CH-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

export async function writeAuditLog(input: WriteAuditLogInput): Promise<void> {
  try {
    if (!AppDataSource.isInitialized) return;

    const repo = AppDataSource.getRepository(AuditChange);
    let actorName = input.actorName?.trim() || "";
    let actorKind: AuditActorKind = input.actorKind ?? "PERSON";
    let actorUserId = input.actorUserId ?? null;

    if (actorUserId && !actorName) {
      const actor = await AppDataSource.getRepository(User).findOne({
        where: { id: actorUserId },
        select: { id: true, fullName: true },
      });
      actorName = actor?.fullName ?? "Unknown";
    }

    if (!actorName) {
      actorName = actorKind === "PROCESS" ? "System process" : "Unknown";
    }

    const row = repo.create({
      reference: makeReference(),
      actorKind,
      actorUserId,
      actorName,
      action: input.action,
      recordType: input.recordType,
      recordId: input.recordId ?? null,
      recordLabel: input.recordLabel,
      recordPath:
        input.recordPath ?? recordPathFor(input.recordType, input.recordId),
      before: input.before ?? null,
      after: input.after ?? null,
    });

    await repo.save(row);
  } catch (error) {
    logger.warn({ err: error, input }, "Failed to write change history");
  }
}
