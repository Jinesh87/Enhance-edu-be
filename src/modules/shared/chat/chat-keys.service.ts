import { AppDataSource } from "../../../config/data-source.js";
import { AppError } from "../../../common/errors/AppError.js";
import { ChatUserPublicKey } from "../../../entities/index.js";

const MAX_PUBLIC_KEY_LENGTH = 2048;

export class ChatKeysService {
  private readonly keys = AppDataSource.getRepository(ChatUserPublicKey);

  async getMyPublicKey(userId: string) {
    const row = await this.keys.findOne({ where: { userId } });
    return {
      publicKey: row?.publicKey ?? null,
      algorithm: row?.algorithm ?? "P-256",
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    };
  }

  async upsertMyPublicKey(userId: string, publicKeyRaw: string) {
    const publicKey = publicKeyRaw.trim();
    if (!publicKey || publicKey.length > MAX_PUBLIC_KEY_LENGTH) {
      throw new AppError(400, "Invalid public key", "CHAT_INVALID_PUBLIC_KEY");
    }
    // Basic base64 sanity check
    if (!/^[A-Za-z0-9+/=\s]+$/.test(publicKey)) {
      throw new AppError(400, "Invalid public key encoding", "CHAT_INVALID_PUBLIC_KEY");
    }

    let row = await this.keys.findOne({ where: { userId } });
    if (!row) {
      row = this.keys.create({
        userId,
        publicKey,
        algorithm: "P-256",
      });
    } else {
      row.publicKey = publicKey;
      row.algorithm = "P-256";
    }
    await this.keys.save(row);
    return {
      publicKey: row.publicKey,
      algorithm: row.algorithm,
      updatedAt: row.updatedAt?.toISOString() ?? new Date().toISOString(),
    };
  }

  async getUserPublicKey(userId: string) {
    const row = await this.keys.findOne({ where: { userId } });
    return {
      userId,
      publicKey: row?.publicKey ?? null,
      algorithm: row?.algorithm ?? "P-256",
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    };
  }

  async getUsersPublicKeys(userIds: string[]) {
    const unique = [...new Set(userIds.filter(Boolean))];
    if (unique.length === 0) return { keys: [] as Array<{
      userId: string;
      publicKey: string | null;
      algorithm: string;
    }> };

    const rows = await this.keys
      .createQueryBuilder("k")
      .where("k.userId IN (:...ids)", { ids: unique })
      .getMany();
    const byId = new Map(rows.map((row) => [row.userId, row]));
    return {
      keys: unique.map((userId) => {
        const row = byId.get(userId);
        return {
          userId,
          publicKey: row?.publicKey ?? null,
          algorithm: row?.algorithm ?? "P-256",
        };
      }),
    };
  }
}

export const chatKeysService = new ChatKeysService();
