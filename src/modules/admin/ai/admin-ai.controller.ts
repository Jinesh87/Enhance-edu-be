import type { NextFunction, Request, Response } from "express";
import { adminAiService } from "./admin-ai.service.js";

type FlushableResponse = Response & { flush?: () => void };

function openAdminAiSse(res: FlushableResponse) {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  // Discourage intermediary buffering; help small token writes go out immediately.
  res.socket?.setNoDelay?.(true);
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }
  // ~2KB comment so common proxies flush the first packets instead of buffering.
  res.write(`:${" ".repeat(2048)}\n\n`);
  if (typeof res.flush === "function") {
    res.flush();
  }
}

function writeSse(
  res: FlushableResponse,
  event: string,
  data: unknown,
) {
  if (res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  if (typeof res.flush === "function") {
    res.flush();
  }
}

class AdminAiController {
  listThreads = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const cursor =
        typeof req.query.cursor === "string" ? req.query.cursor : null;
      const data = await adminAiService.listThreads(req.user!.id, cursor);
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  createThread = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await adminAiService.createThread(req.user!.id);
      res.status(201).json(data);
    } catch (error) {
      next(error);
    }
  };

  getThread = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await adminAiService.getThread(
        req.user!.id,
        req.params.threadId as string,
      );
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  deleteThread = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await adminAiService.deleteThread(
        req.user!.id,
        req.params.threadId as string,
      );
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  sendMessage = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await adminAiService.sendMessage(req.user!.id, {
        content: String(req.body.content ?? ""),
        threadId: req.body.threadId ?? null,
      });
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  sendMessageStream = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    const abort = new AbortController();
    const flushable = res as FlushableResponse;
    let streamStarted = false;

    // Abort only when the *response* connection drops mid-stream.
    const onResponseClose = () => {
      if (!res.writableEnded) {
        abort.abort();
      }
    };
    res.on("close", onResponseClose);

    try {
      openAdminAiSse(flushable);
      streamStarted = true;

      const emit = (event: string, data: unknown) => {
        if (res.writableEnded) return;
        if (abort.signal.aborted && event !== "error") return;
        writeSse(flushable, event, data);
      };

      await adminAiService.sendMessageStream(
        req.user!.id,
        {
          content: String(req.body.content ?? ""),
          threadId: req.body.threadId ?? null,
        },
        emit,
        abort.signal,
      );

      if (!res.writableEnded) {
        res.end();
      }
    } catch (error) {
      if (!streamStarted) {
        next(error);
        return;
      }
      try {
        if (!res.writableEnded) {
          const message =
            error instanceof Error
              ? error.message
              : "Admin AI is temporarily unavailable.";
          writeSse(flushable, "error", {
            message,
            code: "ADMIN_AI_UNAVAILABLE",
          });
          res.end();
        }
      } catch {
        /* client gone */
      }
    } finally {
      res.off("close", onResponseClose);
    }
  };
}

export const adminAiController = new AdminAiController();
