
export const BULK_ACTION_ALLOWLIST = ["send_email"] as const;
export type BulkActionType = (typeof BULK_ACTION_ALLOWLIST)[number];

export const BULK_REAUTH_THRESHOLD = 21;

export const BULK_TYPE_CONFIRM_THRESHOLD = 100;

export const BULK_ABSOLUTE_MAX_RECIPIENTS = 500;

export const BULK_BATCH_SIZE = 40;
export const BULK_SEND_CONCURRENCY = 5;

export function isAllowlistedBulkAction(
  action: string,
): action is BulkActionType {
  return (BULK_ACTION_ALLOWLIST as readonly string[]).includes(action);
}

export function requiresTypeConfirm(sendableCount: number) {
  return sendableCount > BULK_TYPE_CONFIRM_THRESHOLD;
}

export function expectedTypeConfirmPhrase(sendableCount: number) {
  return `SEND ${sendableCount}`;
}

export function assertWithinHardCap(resolvedCount: number) {
  if (resolvedCount > BULK_ABSOLUTE_MAX_RECIPIENTS) {
    return {
      ok: false as const,
      message: `This action affects ${resolvedCount} recipients. Narrow the audience before sending.`,
    };
  }
  if (resolvedCount >= BULK_ABSOLUTE_MAX_RECIPIENTS) {
    return {
      ok: false as const,
      message: `This audience hits the ${BULK_ABSOLUTE_MAX_RECIPIENTS}-recipient limit and may be incomplete. Narrow the audience before sending.`,
    };
  }
  return { ok: true as const };
}
