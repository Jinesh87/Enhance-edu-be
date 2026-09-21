import { Router } from "express";
import { authenticate } from "../../common/middleware/authenticate.js";
import { validate } from "../../common/middleware/validate.js";
import { notificationsController } from "./notifications.controller.js";
import {
  listNotificationsQuerySchema,
  notificationIdParamsSchema,
  pushSubscribeBodySchema,
  pushUnsubscribeBodySchema,
} from "./notifications.validation.js";

const router = Router();

router.use(authenticate);

router.get(
  "/",
  validate(listNotificationsQuerySchema, "query"),
  notificationsController.list,
);
router.get("/unread-count", notificationsController.unreadCount);
router.get("/live-updates", notificationsController.stream);
router.get("/push/vapid-public-key", notificationsController.vapidPublicKey);
router.post(
  "/push/subscribe",
  validate(pushSubscribeBodySchema),
  notificationsController.subscribePush,
);
router.post(
  "/push/unsubscribe",
  validate(pushUnsubscribeBodySchema),
  notificationsController.unsubscribePush,
);
router.post("/read-all", notificationsController.markAllRead);
router.post(
  "/:id/read",
  validate(notificationIdParamsSchema, "params"),
  notificationsController.markRead,
);

export default router;
