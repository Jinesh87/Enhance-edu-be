import type { Server as HttpServer } from "node:http";
import { createAdapter } from "@socket.io/redis-adapter";
import { Server, type Socket } from "socket.io";
import { Redis } from "ioredis";
import { env } from "../../../config/env.js";
import { logger } from "../../../config/logger.js";
import { UserRole } from "../../../common/constants/roles.js";
import { verifyAccessToken } from "../../../common/utils/jwt.js";

export type ChatSocketUser = {
  id: string;
  role: UserRole;
};

type AuthedSocket = Socket & {
  data: {
    user: ChatSocketUser;
    viewingConversationId?: string | null;
  };
};

let io: Server | null = null;
const socketsByUser = new Map<string, Set<string>>();

function redisUrl() {
  return env.REDIS_URL;
}

function parseOrigins(): string[] | boolean {
  if (!env.CORS_ORIGIN) return true;
  return env.CORS_ORIGIN.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseCookieHeader(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      out[key] = part.slice(idx + 1).trim();
    }
  }
  return out;
}

export function isUserOnline(userId: string): boolean {
  const sockets = socketsByUser.get(userId);
  return Boolean(sockets && sockets.size > 0);
}

/** True if any of the user's sockets currently has this conversation focused. */
export async function isUserViewingConversation(
  userId: string,
  conversationId: string,
): Promise<boolean> {
  if (!io || !userId || !conversationId) return false;
  try {
    const sockets = await io
      .in(conversationViewRoom(userId, conversationId))
      .fetchSockets();
    return sockets.length > 0;
  } catch (error) {
    logger.warn({ err: error, userId, conversationId }, "Failed to check chat focus");
    return false;
  }
}

function conversationViewRoom(userId: string, conversationId: string) {
  return `convview:${conversationId}:user:${userId}`;
}

export function emitToUser(userId: string, event: string, payload: unknown) {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, payload);
}

function trackSocket(userId: string, socketId: string) {
  if (!socketsByUser.has(userId)) {
    socketsByUser.set(userId, new Set());
  }
  const set = socketsByUser.get(userId)!;
  const wasOffline = set.size === 0;
  set.add(socketId);
  return wasOffline;
}

function untrackSocket(userId: string, socketId: string) {
  const set = socketsByUser.get(userId);
  if (!set) return false;
  set.delete(socketId);
  if (set.size === 0) {
    socketsByUser.delete(userId);
    return true;
  }
  return false;
}

export function attachChatSocket(httpServer: HttpServer) {
  if (io) return io;

  io = new Server(httpServer, {
    path: "/socket.io",
    cors: {
      origin: parseOrigins(),
      credentials: true,
    },
  });

  const pubClient = new Redis(redisUrl(), { maxRetriesPerRequest: null });
  const subClient = pubClient.duplicate();
  io.adapter(createAdapter(pubClient, subClient));

  io.use((socket, next) => {
    try {
      const cookieHeader = socket.handshake.headers.cookie;
      const cookies = cookieHeader ? parseCookieHeader(cookieHeader) : {};
      const token =
        cookies.access_token ||
        (typeof socket.handshake.auth?.token === "string"
          ? socket.handshake.auth.token
          : undefined);

      if (!token) {
        next(new Error("UNAUTHORIZED"));
        return;
      }

      const payload = verifyAccessToken(token);
      if (
        payload.role !== UserRole.STUDENT &&
        payload.role !== UserRole.STAFF &&
        payload.role !== UserRole.GUARDIAN &&
        payload.role !== UserRole.SUPER_ADMIN
      ) {
        next(new Error("FORBIDDEN"));
        return;
      }

      (socket as AuthedSocket).data.user = {
        id: payload.sub,
        role: payload.role,
      };
      next();
    } catch (error) {
      logger.warn({ err: error }, "Chat socket auth failed");
      next(new Error("UNAUTHORIZED"));
    }
  });

  io.on("connection", (socket) => {
    const user = (socket as AuthedSocket).data.user;
    if (!user) {
      socket.disconnect(true);
      return;
    }

    void socket.join(`user:${user.id}`);
    const cameOnline = trackSocket(user.id, socket.id);
    if (cameOnline) {
      io!.emit("presence:changed", { userId: user.id, online: true });
    }

    socket.emit("presence:snapshot", {
      onlineUserIds: [...socketsByUser.keys()],
    });

    socket.on(
      "conversation:focus",
      (payload: unknown, ack?: (result: unknown) => void) => {
        const conversationId =
          payload &&
          typeof payload === "object" &&
          typeof (payload as { conversationId?: unknown }).conversationId ===
            "string"
            ? (payload as { conversationId: string }).conversationId.trim()
            : "";
        const prev = (socket as AuthedSocket).data.viewingConversationId;
        if (prev && prev !== conversationId) {
          void socket.leave(conversationViewRoom(user.id, prev));
        }
        (socket as AuthedSocket).data.viewingConversationId =
          conversationId || null;
        if (conversationId) {
          void socket.join(conversationViewRoom(user.id, conversationId));
        }
        if (typeof ack === "function") {
          ack({ ok: true, conversationId: conversationId || null });
        }
      },
    );

    socket.on("conversation:blur", (_payload?: unknown, ack?: (result: unknown) => void) => {
      const prev = (socket as AuthedSocket).data.viewingConversationId;
      if (prev) {
        void socket.leave(conversationViewRoom(user.id, prev));
      }
      (socket as AuthedSocket).data.viewingConversationId = null;
      if (typeof ack === "function") ack({ ok: true });
    });

    socket.on(
      "presence:query",
      (userIds: unknown, ack?: (result: unknown) => void) => {
        const ids = Array.isArray(userIds)
          ? userIds.filter((id): id is string => typeof id === "string")
          : [];
        const online: Record<string, boolean> = {};
        for (const id of ids) {
          online[id] = isUserOnline(id);
        }
        if (typeof ack === "function") ack({ online });
        else socket.emit("presence:status", { online });
      },
    );

    socket.on("disconnect", () => {
      const wentOffline = untrackSocket(user.id, socket.id);
      if (wentOffline) {
        io!.emit("presence:changed", { userId: user.id, online: false });
      }
    });
  });

  logger.info("Chat Socket.IO server attached");
  return io;
}

export function getChatSocketServer() {
  return io;
}
