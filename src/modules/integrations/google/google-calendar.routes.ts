import { Router, type NextFunction, type Request, type Response } from "express";
import Joi from "joi";
import { UserRole } from "../../../common/constants/roles.js";
import { authenticate, authorize } from "../../../common/middleware/authenticate.js";
import { validate } from "../../../common/middleware/validate.js";
import { AppError } from "../../../common/errors/AppError.js";
import { logger } from "../../../config/logger.js";
import { publicOrigin } from "./google-calendar-config.service.js";
import { googleCalendarConnectionService } from "./google-calendar-connection.service.js";

const connectSchema = Joi.object({
  returnTo: Joi.string().max(300).allow("", null).optional(),
});

const CONNECT_ROLES = [UserRole.STAFF, UserRole.GUARDIAN];

const googleCalendarRouter = Router();

function redirectWithResult(res: Response, returnTo: string, params: Record<string, string>) {
  const url = new URL(returnTo, publicOrigin());
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  res.redirect(302, url.toString());
}

/** Google redirects the browser here after consent; it carries no session, so the signed state identifies the user. */
googleCalendarRouter.get("/callback", async (req: Request, res: Response) => {
  const state = typeof req.query.state === "string" ? req.query.state : undefined;
  const code = typeof req.query.code === "string" ? req.query.code : undefined;
  const fallback = googleCalendarConnectionService.returnPathFromState(state);

  if (req.query.error || !code || !state) {
    const cancelled = req.query.error === "access_denied";
    redirectWithResult(res, fallback, {
      google: "error",
      reason: cancelled ? "You cancelled the Google sign-in." : "Google sign-in didn't complete.",
    });
    return;
  }

  try {
    const { returnTo } = await googleCalendarConnectionService.handleCallback(code, state);
    redirectWithResult(res, returnTo, { google: "connected" });
  } catch (error) {
    if (!(error instanceof AppError)) logger.error({ err: error }, "Google Calendar callback failed");
    redirectWithResult(res, fallback, {
      google: "error",
      reason: error instanceof AppError ? error.message : "Couldn't connect Google Calendar.",
    });
  }
});

googleCalendarRouter.use(authenticate, authorize(...CONNECT_ROLES));

googleCalendarRouter.get("/connection", async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await googleCalendarConnectionService.status(req.user!.id));
  } catch (error) {
    next(error);
  }
});

googleCalendarRouter.post(
  "/connect",
  validate(connectSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await googleCalendarConnectionService.createAuthUrl(req.user!.id, req.body.returnTo));
    } catch (error) {
      next(error);
    }
  },
);

googleCalendarRouter.delete("/connection", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await googleCalendarConnectionService.disconnect(req.user!.id);
    res.json(await googleCalendarConnectionService.status(req.user!.id));
  } catch (error) {
    next(error);
  }
});

export default googleCalendarRouter;
