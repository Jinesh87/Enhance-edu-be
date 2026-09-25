import { Router, type NextFunction, type Request, type Response } from "express";
import Joi from "joi";
import { UserRole } from "../../../common/constants/roles.js";
import {
  authenticate,
  authorize,
  authorizeAdminModule,
} from "../../../common/middleware/authenticate.js";
import { validate } from "../../../common/middleware/validate.js";
import { adminFinanceService } from "./admin-finance.service.js";

const financeQuerySchema = Joi.object({
  from: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  detailed: Joi.boolean().optional(),
});

const adminFinanceRouter = Router();

adminFinanceRouter.use(
  authenticate,
  authorize(UserRole.SUPER_ADMIN, UserRole.OFFICE_STAFF),
  authorizeAdminModule("finance"),
);

adminFinanceRouter.get(
  "/",
  validate(financeQuerySchema, "query"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(200).json(
        await adminFinanceService.overview({
          from: req.query.from ? String(req.query.from) : undefined,
          to: req.query.to ? String(req.query.to) : undefined,
          detailed: String(req.query.detailed) === "true",
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

export default adminFinanceRouter;
