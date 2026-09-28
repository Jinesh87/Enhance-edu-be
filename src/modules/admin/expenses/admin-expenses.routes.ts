import { Router } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import {
  authenticate,
  authorize,
  authorizeAdminModule,
} from "../../../common/middleware/authenticate.js";
import { validate } from "../../../common/middleware/validate.js";
import { adminExpensesController } from "./admin-expenses.controller.js";
import {
  createFixedExpenseSchema,
  expenseHeadSchema,
  expenseIdParamsSchema,
  expensePeriodQuerySchema,
  updateFixedExpenseSchema,
  variableExpenseSchema,
} from "./admin-expenses.validation.js";

const adminExpensesRouter = Router();

adminExpensesRouter.use(
  authenticate,
  authorize(UserRole.SUPER_ADMIN, UserRole.OFFICE_STAFF),
);

adminExpensesRouter.get("/feature", adminExpensesController.feature);

adminExpensesRouter.use(authorizeAdminModule("expenses"));

adminExpensesRouter.get(
  "/",
  validate(expensePeriodQuerySchema, "query"),
  adminExpensesController.overview,
);

adminExpensesRouter.post(
  "/fixed",
  validate(createFixedExpenseSchema),
  adminExpensesController.createFixed,
);
adminExpensesRouter.put(
  "/fixed/:id",
  validate(expenseIdParamsSchema, "params"),
  validate(updateFixedExpenseSchema),
  adminExpensesController.updateFixed,
);
adminExpensesRouter.delete(
  "/fixed/:id",
  validate(expenseIdParamsSchema, "params"),
  adminExpensesController.deleteFixed,
);

adminExpensesRouter.post(
  "/heads",
  validate(expenseHeadSchema),
  adminExpensesController.createHead,
);
adminExpensesRouter.get(
  "/heads/:id",
  validate(expenseIdParamsSchema, "params"),
  validate(expensePeriodQuerySchema, "query"),
  adminExpensesController.getHead,
);
adminExpensesRouter.put(
  "/heads/:id",
  validate(expenseIdParamsSchema, "params"),
  validate(expenseHeadSchema),
  adminExpensesController.updateHead,
);
adminExpensesRouter.delete(
  "/heads/:id",
  validate(expenseIdParamsSchema, "params"),
  adminExpensesController.deleteHead,
);
adminExpensesRouter.post(
  "/heads/:id/logs",
  validate(expenseIdParamsSchema, "params"),
  validate(variableExpenseSchema),
  adminExpensesController.createLog,
);
adminExpensesRouter.put(
  "/variable/:id",
  validate(expenseIdParamsSchema, "params"),
  validate(variableExpenseSchema),
  adminExpensesController.updateVariable,
);
adminExpensesRouter.delete(
  "/variable/:id",
  validate(expenseIdParamsSchema, "params"),
  adminExpensesController.deleteVariable,
);

export default adminExpensesRouter;
