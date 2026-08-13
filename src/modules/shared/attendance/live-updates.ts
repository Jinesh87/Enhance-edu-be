import { Response } from "express";
import { EventEmitter } from "events";

class LiveUpdateManager {
  private clients: Map<string, Set<Response>> = new Map();
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.on("update", (sessionId: string, data: any) => {
      const sessionClients = this.clients.get(sessionId);
      if (!sessionClients) return;

      const message = `data: ${JSON.stringify(data)}\n\n`;
      for (const client of sessionClients) {
        try {
          client.write(message);
        } catch (err) {
          console.error("Error writing to SSE client:", err);
        }
      }
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
    this.emitter.emit("update", sessionId, data);
  }
}

export const liveUpdateManager = new LiveUpdateManager();
