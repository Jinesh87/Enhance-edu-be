import { AppDataSource } from "../../../config/data-source.js";
import { AdminAiAuditLog } from "../../../entities/AdminAiAuditLog.js";
import { logger } from "../../../config/logger.js";
import type { AdminAiActor } from "./authorization.js";

export type AdminAiAuditInput = {
  requestId: string;
  actor: AdminAiActor;
  conversationId?: string | null;
  eventType: string;
  mode?: string | null;
  toolNames?: string[] | null;
  scopeMetadata?: Record<string, unknown> | null;
  documentIds?: string[] | null;
  resultStatus: string;
  errorCode?: string | null;
};

export async function writeAdminAiAudit(input: AdminAiAuditInput): Promise<void> {
  try {
    if (!AppDataSource.isInitialized) return;
    const repo = AppDataSource.getRepository(AdminAiAuditLog);
    await repo.save(
      repo.create({
        requestId: input.requestId.slice(0, 64),
        actorUserId: input.actor.id,
        actorRole: input.actor.role,
        conversationId: input.conversationId ?? null,
        eventType: input.eventType.slice(0, 60),
        mode: input.mode ?? null,
        toolNames: input.toolNames ?? null,
        scopeMetadata: input.scopeMetadata ?? null,
        documentIds: input.documentIds ?? null,
        resultStatus: input.resultStatus.slice(0, 40),
        errorCode: input.errorCode ?? null,
      }),
    );
  } catch (error) {
    logger.warn({ err: error }, "Failed to write Admin AI audit log");
  }
}
