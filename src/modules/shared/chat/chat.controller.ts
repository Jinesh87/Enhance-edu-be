import type { NextFunction, Request, Response } from "express";
import {
  resolveIncomingFiles,
  respondWithStoredFile,
} from "../../../common/storage/object-storage.js";
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

  searchInConversation = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const data = await chatService.searchInConversation(
        req.user!.id,
        req.user!.role,
        String(req.params.conversationId),
        String(req.query.q ?? ""),
        {
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
      const uploads = resolveIncomingFiles(
        Array.isArray(req.files) ? req.files : undefined,
        req.body,
        req.user!.id,
      );
      const data = await chatService.sendMessage(
        req.user!.id,
        req.user!.role,
        String(req.params.conversationId),
        String(req.body.body ?? ""),
        uploads[0] ?? null,
      );
      res.status(201).json(data);
    } catch (error) {
      next(error);
    }
  };

  getMessageMedia = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const media = await chatService.getMessageMedia(
        req.user!.id,
        req.user!.role,
        String(req.params.conversationId),
        String(req.params.messageId),
      );
      await respondWithStoredFile(res, {
        storageKey: media.storageKey,
        mimeType: media.mimeType,
        originalName: media.originalName,
        inline:
          media.mimeType.toLowerCase().startsWith("image/") ||
          media.mimeType.toLowerCase().startsWith("audio/") ||
          media.mimeType.toLowerCase() === "video/webm" ||
          media.mimeType.toLowerCase() === "video/mp4",
      });
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

  deleteMessage = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await chatService.deleteMessage(
        req.user!.id,
        req.user!.role,
        String(req.params.conversationId),
        String(req.params.messageId),
      );
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  markVoicePlayed = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const data = await chatService.markVoicePlayed(
        req.user!.id,
        req.user!.role,
        String(req.params.conversationId),
        String(req.params.messageId),
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
