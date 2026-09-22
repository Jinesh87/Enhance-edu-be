import type { NextFunction, Request, Response } from "express";
import { adminDashboardService } from "./admin-dashboard.service.js";

class AdminDashboardController {
  snapshot = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await adminDashboardService.getSnapshot();
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };
}

export const adminDashboardController = new AdminDashboardController();
