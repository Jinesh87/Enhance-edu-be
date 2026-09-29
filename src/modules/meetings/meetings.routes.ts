import { Router, type NextFunction, type Request, type Response } from "express";
import Joi from "joi";
import { UserRole } from "../../common/constants/roles.js";
import { authenticate, authorize } from "../../common/middleware/authenticate.js";
import { validate } from "../../common/middleware/validate.js";
import { MEETING_REQUEST_STATUSES } from "../../entities/MeetingRequest.js";
import { MEETING_DURATIONS, meetingsService } from "./meetings.service.js";

const idParamsSchema = Joi.object({ id: Joi.string().uuid().required() });

const timeZoneSchema = Joi.string().trim().max(64).allow(null, "");
const durationSchema = Joi.number()
  .integer()
  .valid(...MEETING_DURATIONS)
  .required();

const availabilityQuerySchema = Joi.object({
  teacherId: Joi.string().uuid().required(),
  date: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .required(),
  durationMinutes: durationSchema,
  timeZone: timeZoneSchema,
  excludeMeetingId: Joi.string().uuid().allow(null, ""),
});

const teacherAvailabilityQuerySchema = Joi.object({
  meetingId: Joi.string().uuid().required(),
  date: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .required(),
  timeZone: timeZoneSchema,
});

const rescheduleSchema = Joi.object({
  startAt: Joi.date().iso().required(),
  note: Joi.string().trim().max(1000).allow(null, ""),
});

const createMeetingSchema = Joi.object({
  teacherId: Joi.string().uuid().required(),
  studentId: Joi.string().uuid().allow(null),
  startAt: Joi.date().iso().required(),
  durationMinutes: durationSchema,
  timeZone: timeZoneSchema,
  topic: Joi.string().trim().min(3).max(200).required(),
  note: Joi.string().trim().max(2000).allow(null, ""),
});

const decisionSchema = Joi.object({
  approve: Joi.boolean().required(),
  note: Joi.string().trim().max(1000).allow(null, ""),
});

const cancelSchema = Joi.object({
  reason: Joi.string().trim().max(1000).allow(null, ""),
});

const adminListQuerySchema = Joi.object({
  view: Joi.string().valid("pending", "all", "cancelled").default("all"),
  status: Joi.string().valid(...MEETING_REQUEST_STATUSES),
  academicYear: Joi.string().trim().max(60).allow(""),
  term: Joi.string().trim().max(120).allow(""),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
});

type Handler = (req: Request, res: Response) => Promise<void>;
const handle = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next);
};

export const guardianMeetingsRouter = Router();
guardianMeetingsRouter.use(authenticate, authorize(UserRole.GUARDIAN));

guardianMeetingsRouter.get(
  "/",
  handle(async (req, res) => {
    res.json({ items: await meetingsService.listForGuardian(req.user!.id) });
  }),
);

guardianMeetingsRouter.get(
  "/options",
  handle(async (req, res) => {
    res.json(await meetingsService.guardianOptions(req.user!.id));
  }),
);

guardianMeetingsRouter.get(
  "/availability",
  validate(availabilityQuerySchema, "query"),
  handle(async (req, res) => {
    const query = req.query as unknown as {
      teacherId: string;
      date: string;
      durationMinutes: string | number;
      timeZone?: string;
      excludeMeetingId?: string;
    };
    res.json(
      await meetingsService.availability(req.user!.id, {
        teacherId: query.teacherId,
        date: query.date,
        timeZone: query.timeZone,
        durationMinutes: Number(query.durationMinutes),
        excludeMeetingId: query.excludeMeetingId || null,
      }),
    );
  }),
);

guardianMeetingsRouter.post(
  "/:id/reschedule",
  validate(idParamsSchema, "params"),
  validate(rescheduleSchema),
  handle(async (req, res) => {
    const meeting = await meetingsService.guardianReschedule(req.user!.id, String(req.params.id), {
      startAt: new Date(req.body.startAt).toISOString(),
      note: req.body.note,
    });
    res.json({ meeting });
  }),
);

guardianMeetingsRouter.post(
  "/",
  validate(createMeetingSchema),
  handle(async (req, res) => {
    const body = req.body as { startAt: Date | string } & Record<string, unknown>;
    const meeting = await meetingsService.create(req.user!.id, {
      ...(req.body as Parameters<typeof meetingsService.create>[1]),
      startAt: new Date(body.startAt).toISOString(),
    });
    res.status(201).json({ meeting });
  }),
);

guardianMeetingsRouter.post(
  "/:id/cancel",
  validate(idParamsSchema, "params"),
  validate(cancelSchema),
  handle(async (req, res) => {
    const meeting = await meetingsService.cancel(
      { id: req.user!.id, role: "GUARDIAN" },
      String(req.params.id),
      req.body.reason,
    );
    res.json({ meeting });
  }),
);

export const teacherMeetingsRouter = Router();
teacherMeetingsRouter.use(authenticate, authorize(UserRole.STAFF));

teacherMeetingsRouter.get(
  "/",
  handle(async (req, res) => {
    res.json({ items: await meetingsService.listForTeacher(req.user!.id) });
  }),
);

teacherMeetingsRouter.get(
  "/availability",
  validate(teacherAvailabilityQuerySchema, "query"),
  handle(async (req, res) => {
    const query = req.query as unknown as { meetingId: string; date: string; timeZone?: string };
    res.json(await meetingsService.teacherAvailability(req.user!.id, query));
  }),
);

teacherMeetingsRouter.post(
  "/:id/reschedule",
  validate(idParamsSchema, "params"),
  validate(rescheduleSchema),
  handle(async (req, res) => {
    const meeting = await meetingsService.teacherReschedule(req.user!.id, String(req.params.id), {
      startAt: new Date(req.body.startAt).toISOString(),
      note: req.body.note,
    });
    res.json({ meeting });
  }),
);

teacherMeetingsRouter.post(
  "/:id/reschedule-response",
  validate(idParamsSchema, "params"),
  validate(decisionSchema),
  handle(async (req, res) => {
    const meeting = await meetingsService.teacherRespondToProposal(req.user!.id, String(req.params.id), {
      accept: req.body.approve,
      note: req.body.note,
    });
    res.json({ meeting });
  }),
);

teacherMeetingsRouter.post(
  "/:id/decision",
  validate(idParamsSchema, "params"),
  validate(decisionSchema),
  handle(async (req, res) => {
    const meeting = await meetingsService.teacherDecide(req.user!.id, String(req.params.id), req.body);
    res.json({ meeting });
  }),
);

teacherMeetingsRouter.post(
  "/:id/cancel",
  validate(idParamsSchema, "params"),
  validate(cancelSchema),
  handle(async (req, res) => {
    const meeting = await meetingsService.cancel(
      { id: req.user!.id, role: "TEACHER" },
      String(req.params.id),
      req.body.reason,
    );
    res.json({ meeting });
  }),
);

export const adminMeetingsRouter = Router();
adminMeetingsRouter.use(authenticate, authorize(UserRole.SUPER_ADMIN));

adminMeetingsRouter.get(
  "/",
  validate(adminListQuerySchema, "query"),
  handle(async (req, res) => {
    const query = req.query as unknown as {
      view: "pending" | "all" | "cancelled";
      status?: (typeof MEETING_REQUEST_STATUSES)[number];
      academicYear?: string;
      term?: string;
      page: number;
      limit: number;
    };
    res.json(await meetingsService.listForAdmin(query));
  }),
);

adminMeetingsRouter.post(
  "/:id/decision",
  validate(idParamsSchema, "params"),
  validate(decisionSchema),
  handle(async (req, res) => {
    const meeting = await meetingsService.adminDecide(req.user!.id, String(req.params.id), req.body);
    res.json({ meeting });
  }),
);
