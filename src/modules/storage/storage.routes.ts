import { Router } from "express";
import { authenticate } from "../../common/middleware/authenticate.js";
import { storageController } from "./storage.controller.js";

const storageRouter = Router();

storageRouter.use(authenticate);
storageRouter.get("/capabilities", storageController.capabilities);
storageRouter.post("/presign-upload", storageController.presignUpload);

export default storageRouter;
