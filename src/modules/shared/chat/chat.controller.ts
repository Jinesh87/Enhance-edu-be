import type { NextFunction, Request, Response } from "express";
import { chatService } from "./chat.service.js";

class ChatController {
  listContacts = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await chatService.listContacts(req.user!.id, req.user!.role);
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  listConversations = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const data = await chatService.listConversations(
        req.user!.id,
        req.user!.role,
      );
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  search = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await chatService.search(
        req.user!.id,
        req.user!.role,
        String(req.query.q ?? ""),
      );
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  openConversation = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const data = await chatService.openConversation(
        req.user!.id,
        req.user!.role,
        String(req.body.peerUserId),
      );
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  listMessages = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await chatService.listMessages(
        req.user!.id,
        req.user!.role,
        String(req.params.conversationId),
        {
          before:
            typeof req.query.before === "string" ? req.query.before : undefined,
          limit: req.query.limit ? Number(req.query.limit) : undefined,
        },
      );
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  sendMessage = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await chatService.sendMessage(
        req.user!.id,
        req.user!.role,
        String(req.params.conversationId),
        String(req.body.body ?? ""),
      );
      res.status(201).json(data);
    } catch (error) {
      next(error);
    }
  };

  markRead = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await chatService.markRead(
        req.user!.id,
        req.user!.role,
        String(req.params.conversationId),
      );
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  unreadCount = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await chatService.unreadCount(req.user!.id);
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };
}

export const chatController = new ChatController();
