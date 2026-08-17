import type { NextFunction, Request, Response } from "express";
import { adminYearLevelsService } from "./admin-year-levels.service.js";

class AdminYearLevelsController {
  list = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const yearLevels = await adminYearLevelsService.list();
      res.status(200).json({ yearLevels });
    } catch (error) {
      next(error);
    }
  };
}

export const adminYearLevelsController = new AdminYearLevelsController();
