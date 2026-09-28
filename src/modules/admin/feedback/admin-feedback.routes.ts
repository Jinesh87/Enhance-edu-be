import { Router, type NextFunction, type Request, type Response } from "express";
import Joi from "joi";
import { UserRole } from "../../../common/constants/roles.js";
import {
  authenticate,
  authorize,
  authorizeAdminModule,
} from "../../../common/middleware/authenticate.js";
import { validate } from "../../../common/middleware/validate.js";
import { adminFeedbackService } from "./admin-feedback.service.js";

const feedbackQuerySchema = Joi.object({
  from: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  rating: Joi.number().integer().min(1).max(5).optional(),
  classId: Joi.string().uuid().optional(),
});

const adminFeedbackRouter = Router();

adminFeedbackRouter.use(
  authenticate,
  authorize(UserRole.SUPER_ADMIN, UserRole.OFFICE_STAFF),
  authorizeAdminModule("feedback"),
);

adminFeedbackRouter.get(
  "/",
  validate(feedbackQuerySchema, "query"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(
        await adminFeedbackService.list({
          from: req.query.from ? String(req.query.from) : undefined,
          to: req.query.to ? String(req.query.to) : undefined,
          rating: req.query.rating ? Number(req.query.rating) : undefined,
          classId: req.query.classId ? String(req.query.classId) : undefined,
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

export default adminFeedbackRouter;
