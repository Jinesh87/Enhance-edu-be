import { Router } from "express";
import multer from "multer";
import { UserRole } from "../../../common/constants/roles.js";
import {
  authenticate,
  authorize,
  authorizeAdminModule,
} from "../../../common/middleware/authenticate.js";
import { validate } from "../../../common/middleware/validate.js";
import { adminSyllabusController } from "./admin-syllabus.controller.js";
import {
  createSyllabusSchema,
  listSyllabusQuerySchema,
  syllabusDocumentParamsSchema,
  syllabusIdParamsSchema,
  updateSyllabusSchema,
} from "./admin-syllabus.validation.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 20 },
});

const adminSyllabusRouter = Router();

adminSyllabusRouter.use(
  authenticate,
  authorize(UserRole.SUPER_ADMIN, UserRole.OFFICE_STAFF),
);

adminSyllabusRouter.get(
  "/",
  authorizeAdminModule("syllabus", "classes", "subjects"),
  validate(listSyllabusQuerySchema, "query"),
  adminSyllabusController.list,
);
adminSyllabusRouter.get(
  "/:id",
  authorizeAdminModule("syllabus", "classes", "subjects"),
  validate(syllabusIdParamsSchema, "params"),
  adminSyllabusController.getById,
);
adminSyllabusRouter.get(
  "/:id/documents/:documentId/download",
  authorizeAdminModule("syllabus", "classes", "subjects"),
  validate(syllabusDocumentParamsSchema, "params"),
  adminSyllabusController.downloadDocument,
);

adminSyllabusRouter.use(authorizeAdminModule("syllabus"));

adminSyllabusRouter.post(
  "/",
  validate(createSyllabusSchema),
  adminSyllabusController.create,
);
adminSyllabusRouter.patch(
  "/:id",
  validate(syllabusIdParamsSchema, "params"),
  validate(updateSyllabusSchema),
  adminSyllabusController.update,
);
adminSyllabusRouter.delete(
  "/:id",
  validate(syllabusIdParamsSchema, "params"),
  adminSyllabusController.remove,
);
adminSyllabusRouter.post(
  "/:id/documents",
  validate(syllabusIdParamsSchema, "params"),
  upload.array("files", 20),
  adminSyllabusController.addDocuments,
);
adminSyllabusRouter.delete(
  "/:id/documents/:documentId",
  validate(syllabusDocumentParamsSchema, "params"),
  adminSyllabusController.removeDocument,
);

export default adminSyllabusRouter;
