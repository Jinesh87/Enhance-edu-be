import { Response } from "express";
import { redis, redisSubscriber } from "../../../config/redis.js";

class LiveUpdateManager {
  private clients: Map<string, Set<Response>> = new Map();

  constructor() {
    redisSubscriber.on("message", (channel: string, message: string) => {
      if (channel === "attendance:update") {
        try {
          const { sessionId, data } = JSON.parse(message);
          const sessionClients = this.clients.get(sessionId);
          if (!sessionClients) return;

          const sseMessage = `data: ${JSON.stringify(data)}\n\n`;
          for (const client of sessionClients) {
            try {
              client.write(sseMessage);
            } catch (err) {
              console.error("Error writing to SSE client:", err);
            }
          }
        } catch (err) {
          console.error("Error handling Redis message:", err);
        }
      }
    });

    redisSubscriber.subscribe("attendance:update").catch((err) => {
      console.error("Failed to subscribe to Redis channel:", err);
    });
  }

  register(sessionId: string, res: Response) {
    if (!this.clients.has(sessionId)) {
      this.clients.set(sessionId, new Set());
    }
    this.clients.get(sessionId)!.add(res);

    res.on("close", () => {
      const sessionClients = this.clients.get(sessionId);
      if (sessionClients) {
        sessionClients.delete(res);
        if (sessionClients.size === 0) {
          this.clients.delete(sessionId);
        }
      }
    });
  }

  broadcast(sessionId: string, data: any) {
    redis
      .publish("attendance:update", JSON.stringify({ sessionId, data }))
      .catch((err) => {
        console.error("Failed to publish live update to Redis:", err);
      });
  }
}

export const liveUpdateManager = new LiveUpdateManager();
