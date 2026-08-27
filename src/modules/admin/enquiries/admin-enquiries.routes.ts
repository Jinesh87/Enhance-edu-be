import { Router } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import {
  authenticate,
  authorize,
  authorizeAdminModule,
} from "../../../common/middleware/authenticate.js";
import { validate } from "../../../common/middleware/validate.js";
import { adminEnquiriesController } from "./admin-enquiries.controller.js";
import {
  bookTrialSchema,
  bulkEnquiriesSchema,
  changeStageSchema,
  convertEnquirySchema,
  createEnquirySchema,
  enquiryIdParamsSchema,
  examResultSchema,
  listEnquiriesQuerySchema,
  trialAttendanceSchema,
  updateEnquirySchema,
} from "./admin-enquiries.validation.js";

const adminEnquiriesRouter = Router();

adminEnquiriesRouter.use(
  authenticate,
  authorize(UserRole.SUPER_ADMIN, UserRole.OFFICE_STAFF),
  authorizeAdminModule("enquiries"),
);

adminEnquiriesRouter.get("/meta", adminEnquiriesController.meta);
adminEnquiriesRouter.get(
  "/",
  validate(listEnquiriesQuerySchema, "query"),
  adminEnquiriesController.list,
);
adminEnquiriesRouter.get(
  "/board",
  validate(listEnquiriesQuerySchema, "query"),
  adminEnquiriesController.board,
);
adminEnquiriesRouter.post(
  "/bulk",
  validate(bulkEnquiriesSchema),
  adminEnquiriesController.bulk,
);
adminEnquiriesRouter.post(
  "/",
  validate(createEnquirySchema),
  adminEnquiriesController.create,
);
adminEnquiriesRouter.get(
  "/:id",
  validate(enquiryIdParamsSchema, "params"),
  adminEnquiriesController.getById,
);
adminEnquiriesRouter.patch(
  "/:id",
  validate(enquiryIdParamsSchema, "params"),
  validate(updateEnquirySchema),
  adminEnquiriesController.update,
);
adminEnquiriesRouter.post(
  "/:id/stage",
  validate(enquiryIdParamsSchema, "params"),
  validate(changeStageSchema),
  adminEnquiriesController.changeStage,
);
adminEnquiriesRouter.post(
  "/:id/trial",
  validate(enquiryIdParamsSchema, "params"),
  validate(bookTrialSchema),
  adminEnquiriesController.bookTrial,
);
adminEnquiriesRouter.post(
  "/:id/attendance",
  validate(enquiryIdParamsSchema, "params"),
  validate(trialAttendanceSchema),
  adminEnquiriesController.trialAttendance,
);
adminEnquiriesRouter.post(
  "/:id/exam",
  validate(enquiryIdParamsSchema, "params"),
  validate(examResultSchema),
  adminEnquiriesController.exam,
);
adminEnquiriesRouter.post(
  "/:id/offer",
  validate(enquiryIdParamsSchema, "params"),
  adminEnquiriesController.offer,
);
adminEnquiriesRouter.post(
  "/:id/reject",
  validate(enquiryIdParamsSchema, "params"),
  adminEnquiriesController.reject,
);
adminEnquiriesRouter.post(
  "/:id/convert",
  validate(enquiryIdParamsSchema, "params"),
  validate(convertEnquirySchema),
  adminEnquiriesController.convert,
);

export default adminEnquiriesRouter;
