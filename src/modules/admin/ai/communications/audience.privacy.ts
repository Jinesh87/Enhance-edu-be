import { In } from "typeorm";
import { AppDataSource } from "../../../../config/data-source.js";
import { User } from "../../../../entities/User.js";
import type { CommunicationRecipientSnapshot } from "../../../../entities/AdminAiCommunicationDraft.js";

/**
 * Privacy helpers for communication recipients.
 * Raw contact details are resolved at send-time only — never persisted in drafts
 * and never returned to AI / FE DTOs.
 */

type LegacyRecipient = CommunicationRecipientSnapshot & {
  email?: string | null;
};

export function recipientHasEmail(
  row: CommunicationRecipientSnapshot | LegacyRecipient,
): boolean {
  if (typeof row.hasEmail === "boolean") return row.hasEmail;
  const legacy = row as LegacyRecipient;
  return Boolean(legacy.email?.trim());
}

/** Persistable snapshot shape: no raw email/phone. */
export function toStoredRecipient(
  row: CommunicationRecipientSnapshot & { email?: string | null },
): CommunicationRecipientSnapshot {
  return {
    userId: row.userId,
    name: row.name,
    hasEmail: recipientHasEmail(row),
    role: row.role ?? null,
    studentNames: row.studentNames ?? [],
    relationshipLabel: row.relationshipLabel ?? null,
    selected: row.selected !== false,
    status: row.status,
    errorReason: row.errorReason ?? null,
    providerMessageId: row.providerMessageId ?? null,
  };
}

export function sanitizeRecipientsForStorage(
  rows: Array<CommunicationRecipientSnapshot & { email?: string | null }>,
): CommunicationRecipientSnapshot[] {
  return rows.map(toStoredRecipient);
}

/** Load delivery emails for owned send — never expose this map to AI/FE. */
export async function loadDeliveryEmailsByUserId(
  userIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  const out = new Map<string, string>();
  if (!ids.length) return out;

  const users = await AppDataSource.getRepository(User).find({
    where: { id: In(ids) },
    select: { id: true, email: true },
  });

  for (const user of users) {
    const email = user.email?.trim();
    if (email) out.set(user.id, email);
  }
  return out;
}
