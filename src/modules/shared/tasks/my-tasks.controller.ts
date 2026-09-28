import type { NextFunction, Request, Response } from "express";
import { myTasksService } from "./my-tasks.service.js";
import type { CorrectableStatus, MyTaskTab } from "./my-tasks.validation.js";

class MyTasksController {
  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await myTasksService.list(req.user!.id, {
        tab: req.query.tab as MyTaskTab,
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 10,
        search: typeof req.query.search === "string" ? req.query.search : undefined,
        filter: typeof req.query.filter === "string" ? req.query.filter : undefined,
        sortOrder: req.query.sortOrder === "DESC" ? "DESC" : "ASC",
      });
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  getById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const task = await myTasksService.getById(
        req.user!.id,
        req.params.id as string,
      );
      res.status(200).json({ task });
    } catch (error) {
      next(error);
    }
  };

  complete = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const task = await myTasksService.complete(
        req.user!.id,
        req.params.id as string,
        {
          status: req.body.status as CorrectableStatus,
          reason: req.body.reason as string,
        },
      );
      res.status(200).json({ task });
    } catch (error) {
      next(error);
    }
  };
}

export const myTasksController = new MyTasksController();
