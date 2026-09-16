import { IsNull } from "typeorm";
import { AppDataSource } from "../../../config/data-source.js";
import { logger } from "../../../config/logger.js";
import { ChatMessage } from "../../../entities/index.js";
import {
  guessMimeFromFileName,
  listObjectKeys,
} from "../../../common/storage/object-storage.js";

/**
 * Relink chat messages that have files in object storage but missing DB media
 * metadata (storageKey / mimeType / originalName).
 */
export async function repairChatMessageMediaLinks() {
  const repo = AppDataSource.getRepository(ChatMessage);
  const orphaned = await repo.find({
    where: { storageKey: IsNull() },
    select: {
      id: true,
      conversationId: true,
      storageKey: true,
      originalName: true,
      mimeType: true,
      byteSize: true,
    },
  });
  if (orphaned.length === 0) return { repaired: 0 };

  let objects: Array<{ key: string; size: number }> = [];
  try {
    objects = await listObjectKeys("chat/");
  } catch (error) {
    logger.warn({ err: error }, "Could not list chat media for repair");
    return { repaired: 0 };
  }

  const byMessageId = new Map<
    string,
    { key: string; size: number; fileName: string; conversationId: string }
  >();
  for (const obj of objects) {
    const parts = obj.key.split("/");
    // chat/{conversationId}/{messageId}/{timestamp}-{fileName}
    if (parts.length < 4 || parts[0] !== "chat") continue;
    const conversationId = parts[1]!;
    const messageId = parts[2]!;
    const rawName = parts.slice(3).join("/");
    const fileName = rawName.replace(/^\d+-/, "") || rawName;
    const prev = byMessageId.get(messageId);
    if (!prev || obj.size >= prev.size) {
      byMessageId.set(messageId, {
        key: obj.key,
        size: obj.size,
        fileName,
        conversationId,
      });
    }
  }

  let repaired = 0;
  for (const message of orphaned) {
    const file = byMessageId.get(message.id);
    if (!file) continue;
    if (file.conversationId !== message.conversationId) continue;

    message.storageKey = file.key;
    message.originalName = file.fileName;
    message.mimeType = guessMimeFromFileName(file.fileName);
    message.byteSize = file.size;
    await repo.save(message);
    repaired += 1;
  }

  if (repaired > 0) {
    logger.info({ repaired }, "Repaired chat messages missing media metadata");
  }
  return { repaired };
}
