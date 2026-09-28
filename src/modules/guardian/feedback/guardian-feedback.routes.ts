import { Router, type NextFunction, type Request, type Response } from "express";
import Joi from "joi";
import { UserRole } from "../../../common/constants/roles.js";
import { authenticate, authorize } from "../../../common/middleware/authenticate.js";
import { validate } from "../../../common/middleware/validate.js";
import { guardianFeedbackService } from "./guardian-feedback.service.js";

const submitFeedbackSchema = Joi.object({
  sessionId: Joi.string().uuid().required(),
  studentId: Joi.string().uuid().required(),
  rating: Joi.number().integer().min(1).max(5).required(),
  comment: Joi.string().trim().max(2000).allow(null, ""),
});

const guardianFeedbackRouter = Router();

guardianFeedbackRouter.use(authenticate, authorize(UserRole.GUARDIAN));

guardianFeedbackRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ items: await guardianFeedbackService.list(req.user!.id) });
  } catch (error) {
    next(error);
  }
});

guardianFeedbackRouter.post(
  "/",
  validate(submitFeedbackSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const feedback = await guardianFeedbackService.submit(req.user!.id, req.body);
      res.status(200).json({ feedback });
    } catch (error) {
      next(error);
    }
  },
);

export default guardianFeedbackRouter;
