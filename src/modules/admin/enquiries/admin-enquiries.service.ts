import { In, IsNull, type Repository } from "typeorm";
import {
  EnquiryExamOutcome,
  EnquiryNurtureState,
  EnquiryStageKind,
} from "../../../common/constants/enquiry.js";
import { UserRole } from "../../../common/constants/roles.js";
import { AppError } from "../../../common/errors/AppError.js";
import { AppDataSource } from "../../../config/data-source.js";
import {
  Enquiry,
  EnquiryCompetitor,
  EnquiryEvent,
  EnquiryLossReason,
  EnquirySource,
  EnquiryStage,
  EnquiryStageHistory,
  User,
} from "../../../entities/index.js";
import { adminEnrollmentsService } from "../enrollments/admin-enrollments.service.js";

/** Postgres advisory lock key — serialises waiting-list join/leave renumbers. */
const WAITING_LIST_LOCK_KEY = 814_229_001;

const ENQUIRY_RELATIONS = {
  firstSource: true,
  lastSource: true,
  owner: true,
  currentStage: true,
  lostReason: true,
  competitor: true,
} as const;

type Named = { id: string; name: string };

function named(row: { id: string; name: string } | null | undefined): Named | null {
  if (!row) return null;
  return { id: row.id, name: row.name };
}

function ownerDto(user: User | null | undefined) {
  if (!user) return null;
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
  };
}

function daysIdleSince(at: Date) {
  return Math.max(0, Math.floor((Date.now() - at.getTime()) / 86_400_000));
}

function toEnquiryDto(
  enquiry: Enquiry,
  extra?: {
    history?: EnquiryStageHistory[];
    events?: EnquiryEvent[];
  },
) {
  return {
    id: enquiry.id,
    studentFullName: enquiry.studentFullName,
    yearLevel: enquiry.yearLevel,
    school: enquiry.school,
    subjectOfInterest: enquiry.subjectOfInterest,
    guardianFullName: enquiry.guardianFullName,
    guardianEmail: enquiry.guardianEmail,
    guardianMobile: enquiry.guardianMobile,
    firstSource: named(enquiry.firstSource),
    lastSource: named(enquiry.lastSource),
    owner: ownerDto(enquiry.owner),
    stage: enquiry.currentStage
      ? {
          id: enquiry.currentStage.id,
          code: enquiry.currentStage.code,
          name: enquiry.currentStage.name,
          kind: enquiry.currentStage.kind,
          sortOrder: enquiry.currentStage.sortOrder,
        }
      : null,
    daysIdle: daysIdleSince(enquiry.lastStageChangedAt),
    score: enquiry.score,
    waitingListPosition: enquiry.waitingListPosition,
    nurtureState: enquiry.nurtureState,
    trialClassName: enquiry.trialClassName,
    trialEndDate: enquiry.trialEndDate,
    trialConfirmed: enquiry.trialConfirmed,
    trialAttended: enquiry.trialAttended,
    examSession: enquiry.examSession,
    examMark: enquiry.examMark == null ? null : Number(enquiry.examMark),
    examThreshold:
      enquiry.examThreshold == null ? null : Number(enquiry.examThreshold),
    examOutcome: enquiry.examOutcome,
    examMarkedBy: enquiry.examMarkedBy,
    examScriptReference: enquiry.examScriptReference,
    lostReason: named(enquiry.lostReason),
    competitor: named(enquiry.competitor),
    flagForReengagement: enquiry.flagForReengagement,
    linkedFromEnquiryId: enquiry.linkedFromEnquiryId,
    convertedEnrollmentId: enquiry.convertedEnrollmentId,
    closedAt: enquiry.closedAt,
    createdAt: enquiry.createdAt,
    updatedAt: enquiry.updatedAt,
    history: extra?.history?.map((row) => ({
      id: row.id,
      fromStage: named(row.fromStage),
      toStage: named(row.toStage),
      actor: ownerDto(row.actor),
      lostReason: named(row.lostReason),
      competitor: named(row.competitor),
      note: row.note,
      createdAt: row.createdAt,
    })),
    events: extra?.events?.map((row) => ({
      id: row.id,
      kind: row.kind,
      body: row.body,
      actor: ownerDto(row.actor),
      createdAt: row.createdAt,
    })),
  };
}

export class AdminEnquiriesService {
  private readonly enquiries = AppDataSource.getRepository(Enquiry);
  private readonly stages = AppDataSource.getRepository(EnquiryStage);
  private readonly sources = AppDataSource.getRepository(EnquirySource);
  private readonly reasons = AppDataSource.getRepository(EnquiryLossReason);
  private readonly competitors = AppDataSource.getRepository(EnquiryCompetitor);
  private readonly history = AppDataSource.getRepository(EnquiryStageHistory);
  private readonly events = AppDataSource.getRepository(EnquiryEvent);
  private readonly users = AppDataSource.getRepository(User);

  async meta() {
    const [stages, sources, reasons, competitors, owners] = await Promise.all([
      this.stages.find({ order: { sortOrder: "ASC" } }),
      this.sources.find({
        where: { retiredAt: IsNull() },
        order: { sortOrder: "ASC" },
      }),
      this.reasons.find({
        where: { retiredAt: IsNull() },
        relations: { stage: true },
        order: { name: "ASC" },
      }),
      this.competitors.find({
        where: { retiredAt: IsNull() },
        order: { name: "ASC" },
      }),
      this.users.find({
        where: [{ role: UserRole.SUPER_ADMIN }, { role: UserRole.OFFICE_STAFF }],
        select: { id: true, fullName: true, email: true, role: true },
        order: { fullName: "ASC" },
      }),
    ]);

    return {
      stages: stages.map((stage) => ({
        id: stage.id,
        code: stage.code,
        name: stage.name,
        kind: stage.kind,
        sortOrder: stage.sortOrder,
        retired: Boolean(stage.retiredAt),
      })),
      sources: sources.map((source) => ({ id: source.id, name: source.name })),
      lossReasons: reasons.map((reason) => ({
        id: reason.id,
        name: reason.name,
        stageId: reason.stageId,
        requiresCompetitor: reason.requiresCompetitor,
      })),
      competitors: competitors.map((row) => ({ id: row.id, name: row.name })),
      owners: owners.map((user) => ({
        id: user.id,
        fullName: user.fullName,
        email: user.email,
      })),
    };
  }

  async list(filters: {
    page?: number;
    limit?: number;
    search?: string;
    stageId?: string;
    ownerUserId?: string;
    sourceId?: string;
    status?: string;
    idleDays?: number;
    sort?: string;
  }) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;

    const qb = this.enquiries
      .createQueryBuilder("enquiry")
      .leftJoinAndSelect("enquiry.firstSource", "firstSource")
      .leftJoinAndSelect("enquiry.lastSource", "lastSource")
      .leftJoinAndSelect("enquiry.owner", "owner")
      .leftJoinAndSelect("enquiry.currentStage", "stage")
      .leftJoinAndSelect("enquiry.lostReason", "lostReason")
      .leftJoinAndSelect("enquiry.competitor", "competitor");

    this.applyFilters(qb, filters);

    if (filters.sort === "idle") {
      qb.orderBy("enquiry.lastStageChangedAt", "ASC");
    } else if (filters.sort === "score") {
      qb.orderBy("enquiry.score", "DESC", "NULLS LAST");
    } else if (filters.sort === "student") {
      qb.orderBy("enquiry.studentFullName", "ASC", "NULLS LAST");
    } else if (filters.sort === "created") {
      qb.orderBy("enquiry.createdAt", "DESC");
    } else {
      qb.orderBy("enquiry.lastStageChangedAt", "DESC");
    }

    const total = await qb.getCount();
    const rows = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    return { enquiries: rows.map((row) => toEnquiryDto(row)), total };
  }

  async board(filters: {
    search?: string;
    ownerUserId?: string;
    sourceId?: string;
    idleDays?: number;
  }) {
    const stages = await this.stages.find({
      where: { retiredAt: IsNull() },
      order: { sortOrder: "ASC" },
    });
    const openStages = stages.filter(
      (stage) => stage.kind === EnquiryStageKind.OPEN,
    );

    const qb = this.enquiries
      .createQueryBuilder("enquiry")
      .leftJoinAndSelect("enquiry.firstSource", "firstSource")
      .leftJoinAndSelect("enquiry.lastSource", "lastSource")
      .leftJoinAndSelect("enquiry.owner", "owner")
      .leftJoinAndSelect("enquiry.currentStage", "stage")
      .leftJoinAndSelect("enquiry.lostReason", "lostReason")
      .leftJoinAndSelect("enquiry.competitor", "competitor")
      .andWhere("stage.kind = :open", { open: EnquiryStageKind.OPEN });

    this.applyFilters(qb, { ...filters, status: "open" });
    qb.orderBy("enquiry.waitingListPosition", "ASC", "NULLS LAST").addOrderBy(
      "enquiry.lastStageChangedAt",
      "ASC",
    );

    const rows = await qb.getMany();
    const grouped = new Map<string, ReturnType<typeof toEnquiryDto>[]>();
    for (const stage of openStages) grouped.set(stage.id, []);
    for (const row of rows) {
      const list = grouped.get(row.currentStageId);
      if (list) list.push(toEnquiryDto(row));
    }

    return {
      columns: openStages.map((stage) => ({
        id: stage.id,
        code: stage.code,
        name: stage.name,
        kind: stage.kind,
        count: grouped.get(stage.id)?.length ?? 0,
        enquiries: grouped.get(stage.id) ?? [],
      })),
      lostStage: stages.find((stage) => stage.kind === EnquiryStageKind.LOST) ?? null,
    };
  }

  async getById(id: string) {
    const enquiry = await this.requireEnquiry(id);
    const [history, events] = await Promise.all([
      this.history.find({
        where: { enquiryId: id },
        relations: { fromStage: true, toStage: true, actor: true, lostReason: true, competitor: true },
        order: { createdAt: "DESC" },
      }),
      this.events.find({
        where: { enquiryId: id },
        relations: { actor: true },
        order: { createdAt: "DESC" },
      }),
    ]);
    return toEnquiryDto(enquiry, { history, events });
  }

  async create(
    input: {
      studentFullName?: string | null;
      yearLevel: number;
      school?: string | null;
      subjectOfInterest: string;
      guardianFullName: string;
      guardianEmail?: string | null;
      guardianMobile?: string | null;
      sourceId: string;
      ownerUserId?: string | null;
      score?: number | null;
    },
    actorId: string,
  ) {
    const source = await this.sources.findOne({ where: { id: input.sourceId } });
    if (!source) throw new AppError(400, "Source not found", "SOURCE_NOT_FOUND");

    const stage = await this.stages.findOne({ where: { code: "new" } });
    if (!stage) throw new AppError(500, "Enquiry stages are not seeded", "STAGES_MISSING");

    const now = new Date();
    const enquiry = this.enquiries.create({
      studentFullName: input.studentFullName?.trim() || null,
      yearLevel: input.yearLevel,
      school: input.school?.trim() || null,
      subjectOfInterest: input.subjectOfInterest.trim(),
      guardianFullName: input.guardianFullName.trim(),
      guardianEmail: input.guardianEmail?.trim().toLowerCase() || null,
      guardianMobile: input.guardianMobile?.trim() || null,
      firstSourceId: source.id,
      lastSourceId: source.id,
      ownerUserId: input.ownerUserId || actorId,
      currentStageId: stage.id,
      currentStage: stage,
      lastStageChangedAt: now,
      score: input.score ?? null,
      waitingListPosition: null,
      nurtureState: EnquiryNurtureState.NONE,
    });
    await this.enquiries.save(enquiry);

    await this.writeHistory(enquiry.id, null, stage.id, actorId, null, null, "Captured");
    await this.writeEvent(
      enquiry.id,
      "CAPTURED",
      `Enquiry captured from ${source.name}`,
      actorId,
    );

    return this.getById(enquiry.id);
  }

  async update(
    id: string,
    input: Record<string, unknown>,
    actorId: string,
  ) {
    const enquiry = await this.requireOpen(id);
    if ("firstSourceId" in input) {
      throw new AppError(400, "First source cannot be changed", "FIRST_SOURCE_IMMUTABLE");
    }

    const assignable: (keyof Enquiry)[] = [
      "studentFullName",
      "yearLevel",
      "school",
      "subjectOfInterest",
      "guardianFullName",
      "guardianEmail",
      "guardianMobile",
      "lastSourceId",
      "ownerUserId",
      "score",
      "nurtureState",
      "trialClassName",
      "trialEndDate",
      "examSession",
      "examScriptReference",
    ];

    for (const key of assignable) {
      if (key in input) {
        const value = input[key];
        if (key === "guardianEmail" && typeof value === "string") {
          enquiry.guardianEmail = value.trim().toLowerCase() || null;
        } else if (key === "subjectOfInterest" && typeof value === "string") {
          const trimmed = value.trim();
          if (!trimmed) {
            throw new AppError(
              400,
              "Subject of interest is required",
              "VALIDATION_ERROR",
            );
          }
          enquiry.subjectOfInterest = trimmed;
        } else if (key === "yearLevel") {
          if (value == null || value === "") {
            throw new AppError(
              400,
              "Year group is required",
              "VALIDATION_ERROR",
            );
          }
          enquiry.yearLevel = Number(value);
        } else if (
          (key === "studentFullName" ||
            key === "school" ||
            key === "guardianMobile" ||
            key === "trialClassName" ||
            key === "trialEndDate" ||
            key === "examSession" ||
            key === "examScriptReference") &&
          typeof value === "string"
        ) {
          (enquiry as unknown as Record<string, unknown>)[key] = value.trim() || null;
        } else if (key === "ownerUserId") {
          enquiry.ownerUserId = (value as string | null) || null;
        } else {
          (enquiry as unknown as Record<string, unknown>)[key] = value ?? null;
        }
      }
    }

    if (enquiry.yearLevel == null || !enquiry.subjectOfInterest?.trim()) {
      throw new AppError(
        400,
        "Year group and subject of interest are required",
        "VALIDATION_ERROR",
      );
    }

    if ("examThreshold" in input) {
      enquiry.examThreshold =
        input.examThreshold == null ? null : String(input.examThreshold);
    }

    await this.enquiries.save(enquiry);
    await this.writeEvent(id, "EDITED", "Enquiry details updated", actorId);
    return this.getById(id);
  }

  async changeStage(
    id: string,
    input: {
      stageId: string;
      lostReasonId?: string | null;
      competitorId?: string | null;
      flagForReengagement?: boolean;
      note?: string | null;
    },
    actorId: string,
  ) {
    const enquiry = await this.requireOpen(id);
    const stage = await this.stages.findOne({ where: { id: input.stageId } });
    if (!stage || stage.retiredAt) {
      throw new AppError(400, "Stage not found", "STAGE_NOT_FOUND");
    }
    if (stage.kind === EnquiryStageKind.CONVERTED) {
      throw new AppError(
        400,
        "Use convert to enrolment to close this enquiry",
        "CONVERT_REQUIRED",
      );
    }

    if (stage.kind === EnquiryStageKind.LOST) {
      await this.applyLost(enquiry, stage, input, actorId);
    } else {
      const fromStageId = enquiry.currentStageId;
      const leavingWaiting = this.isOnWaitingList(enquiry) && stage.code !== "waiting_list";
      const joiningWaiting = stage.code === "waiting_list" && !this.isOnWaitingList(enquiry);

      enquiry.lostReasonId = null;
      enquiry.competitorId = null;
      enquiry.closedAt = null;

      if (leavingWaiting) this.clearWaitingListMembership(enquiry);
      this.assignStage(enquiry, stage);

      if (joiningWaiting) {
        await this.saveJoiningWaitingList(enquiry);
      } else {
        await this.enquiries.save(enquiry);
        if (leavingWaiting) await this.recompactWaitingList();
      }

      await this.writeHistory(
        enquiry.id,
        fromStageId,
        stage.id,
        actorId,
        null,
        null,
        input.note ?? null,
      );
      await this.writeEvent(
        enquiry.id,
        "STAGE",
        `Moved to ${stage.name}`,
        actorId,
      );
    }

    return this.getById(id);
  }

  async bookTrial(
    id: string,
    input: { trialClassName: string; trialEndDate?: string | null; confirmed: boolean },
    actorId: string,
  ) {
    const enquiry = await this.requireOpen(id);
    if (!input.confirmed) {
      throw new AppError(
        400,
        "A trial booking must be confirmed because places are pre-assigned",
        "TRIAL_NOT_CONFIRMED",
      );
    }
    const stage = await this.requireStageByCode("trial_booked");
    const fromStageId = enquiry.currentStageId;
    const leavingWaiting = this.isOnWaitingList(enquiry);
    enquiry.trialClassName = input.trialClassName.trim();
    enquiry.trialEndDate = input.trialEndDate || null;
    enquiry.trialConfirmed = true;
    if (leavingWaiting) this.clearWaitingListMembership(enquiry);
    this.assignStage(enquiry, stage);
    await this.enquiries.save(enquiry);
    if (leavingWaiting) await this.recompactWaitingList();
    await this.writeHistory(enquiry.id, fromStageId, stage.id, actorId);
    await this.writeEvent(
      enquiry.id,
      "TRIAL_BOOKED",
      `Trial place confirmed in ${enquiry.trialClassName}`,
      actorId,
    );
    return this.getById(id);
  }

  async recordTrialAttendance(id: string, attended: boolean, actorId: string) {
    const enquiry = await this.requireOpen(id);
    enquiry.trialAttended = attended;
    if (attended) {
      const fromStageId = enquiry.currentStageId;
      const leavingWaiting = this.isOnWaitingList(enquiry);
      const stage = await this.requireStageByCode("trial_attended");
      if (leavingWaiting) this.clearWaitingListMembership(enquiry);
      this.assignStage(enquiry, stage);
      await this.writeHistory(enquiry.id, fromStageId, stage.id, actorId);
      await this.enquiries.save(enquiry);
      if (leavingWaiting) await this.recompactWaitingList();
    } else {
      await this.enquiries.save(enquiry);
    }
    await this.writeEvent(
      enquiry.id,
      "TRIAL_ATTENDANCE",
      attended ? "Attended the trial class" : "Did not attend the trial class",
      actorId,
    );
    return this.getById(id);
  }

  async recordExam(
    id: string,
    input: {
      examSession?: string | null;
      examMark: number;
      examThreshold: number;
      examMarkedBy: string;
      examScriptReference?: string | null;
    },
    actorId: string,
  ) {
    const enquiry = await this.requireOpen(id);
    const stage = await this.requireStageByCode("entrance_exam");
    const fromStageId = enquiry.currentStageId;
    const leavingWaiting = this.isOnWaitingList(enquiry);
    let outcome = EnquiryExamOutcome.FAIL;
    if (input.examMark >= input.examThreshold) outcome = EnquiryExamOutcome.PASS;
    else if (input.examMark >= input.examThreshold * 0.9) {
      outcome = EnquiryExamOutcome.BORDERLINE;
    }

    enquiry.examSession = input.examSession?.trim() || enquiry.examSession;
    enquiry.examMark = String(input.examMark);
    enquiry.examThreshold = String(input.examThreshold);
    enquiry.examOutcome = outcome;
    enquiry.examMarkedBy = input.examMarkedBy.trim();
    enquiry.examScriptReference = input.examScriptReference?.trim() || null;
    if (leavingWaiting) this.clearWaitingListMembership(enquiry);
    this.assignStage(enquiry, stage);
    await this.enquiries.save(enquiry);
    if (leavingWaiting) await this.recompactWaitingList();
    await this.writeHistory(enquiry.id, fromStageId, stage.id, actorId);
    await this.writeEvent(
      enquiry.id,
      "EXAM",
      `Exam marked ${input.examMark} against ${input.examThreshold} (${outcome.toLowerCase()}) by ${enquiry.examMarkedBy}`,
      actorId,
    );
    return this.getById(id);
  }

  async issueOffer(id: string, actorId: string) {
    const enquiry = await this.requireOpen(id);
    if (enquiry.examOutcome === EnquiryExamOutcome.FAIL) {
      throw new AppError(
        400,
        "A fail cannot become an offer. Send a rejection instead",
        "EXAM_FAILED",
      );
    }
    const stage = await this.requireStageByCode("offer");
    const fromStageId = enquiry.currentStageId;
    const leavingWaiting = this.isOnWaitingList(enquiry);
    if (leavingWaiting) this.clearWaitingListMembership(enquiry);
    this.assignStage(enquiry, stage);
    await this.enquiries.save(enquiry);
    if (leavingWaiting) await this.recompactWaitingList();
    await this.writeHistory(enquiry.id, fromStageId, stage.id, actorId);
    await this.writeEvent(enquiry.id, "OFFER", "Offer of study issued", actorId);
    return this.getById(id);
  }

  async rejectExam(id: string, actorId: string) {
    const enquiry = await this.requireOpen(id);
    const lost = await this.requireStageByCode("lost");
    const waiting = await this.requireStageByCode("waiting_list");
    const reason = await this.reasons.findOne({
      where: { name: "Did not meet the threshold", retiredAt: IsNull() },
    });

    const fromStageId = enquiry.currentStageId;
    const leavingWaiting = this.isOnWaitingList(enquiry);
    if (leavingWaiting) this.clearWaitingListMembership(enquiry);
    this.assignStage(enquiry, lost);
    enquiry.closedAt = new Date();
    enquiry.lastStageChangedAt = enquiry.closedAt;
    enquiry.lostReasonId = reason?.id ?? null;
    await this.enquiries.save(enquiry);
    if (leavingWaiting) await this.recompactWaitingList();
    await this.writeHistory(
      enquiry.id,
      fromStageId,
      lost.id,
      actorId,
      reason?.id ?? null,
      null,
      "Rejected after entrance exam",
    );
    await this.writeEvent(
      enquiry.id,
      "REJECTED",
      "Rejection recorded. A new waiting-list enquiry was opened for the next holiday intake",
      actorId,
    );

    const followOn = this.enquiries.create({
      studentFullName: enquiry.studentFullName,
      yearLevel: enquiry.yearLevel,
      school: enquiry.school,
      subjectOfInterest: enquiry.subjectOfInterest,
      guardianFullName: enquiry.guardianFullName,
      guardianEmail: enquiry.guardianEmail,
      guardianMobile: enquiry.guardianMobile,
      firstSourceId: enquiry.firstSourceId,
      lastSourceId: enquiry.lastSourceId,
      ownerUserId: enquiry.ownerUserId,
      currentStageId: waiting.id,
      currentStage: waiting,
      lastStageChangedAt: new Date(),
      score: enquiry.score,
      waitingListPosition: null,
      nurtureState: EnquiryNurtureState.NONE,
      linkedFromEnquiryId: enquiry.id,
    });
    await this.saveJoiningWaitingList(followOn);
    await this.writeHistory(followOn.id, null, waiting.id, actorId, null, null, "Opened after exam rejection");
    await this.writeEvent(
      followOn.id,
      "CAPTURED",
      "Opened for the next holiday intake after an exam rejection",
      actorId,
    );

    return { enquiry: await this.getById(id), followOn: await this.getById(followOn.id) };
  }

  async convert(
    id: string,
    input: Parameters<AdminEnrollmentsService["inviteWithEnrollment"]>[0],
    actorId: string,
  ) {
    const enquiry = await this.requireOpen(id);
    if (!input.student.fullName.trim()) {
      throw new AppError(400, "Name the student before converting", "STUDENT_REQUIRED");
    }

    const result = await adminEnrollmentsService.inviteWithEnrollment(input, actorId);
    const converted = await this.requireStageByCode("converted");

    const fromStageId = enquiry.currentStageId;
    const leavingWaiting = this.isOnWaitingList(enquiry);
    if (leavingWaiting) this.clearWaitingListMembership(enquiry);
    this.assignStage(enquiry, converted);
    enquiry.closedAt = new Date();
    enquiry.lastStageChangedAt = enquiry.closedAt;
    enquiry.convertedEnrollmentId = result.enrollment?.id ?? null;
    enquiry.studentFullName = input.student.fullName.trim();
    await this.enquiries.save(enquiry);
    if (leavingWaiting) await this.recompactWaitingList();
    await this.writeHistory(enquiry.id, fromStageId, converted.id, actorId);
    await this.writeEvent(
      enquiry.id,
      "CONVERTED",
      "Converted to enrolment. Agreement, remaining-term enrolments, payment schedule and onboarding tasks are created together when those modules are live — this close is permanent either way",
      actorId,
    );

    return {
      enquiry: await this.getById(id),
      enrollment: result.enrollment,
      awaitingGuardianAcceptance: result.awaitingGuardianAcceptance,
    };
  }

  async bulk(
    input: {
      ids: string[];
      ownerUserId?: string | null;
      lastSourceId?: string;
      stageId?: string;
      lostReasonId?: string | null;
      competitorId?: string | null;
    },
    actorId: string,
  ) {
    const rows = await this.enquiries.find({
      where: { id: In(input.ids) },
      relations: ENQUIRY_RELATIONS,
    });
    for (const row of rows) {
      if (row.closedAt) continue;
      if (input.ownerUserId !== undefined) row.ownerUserId = input.ownerUserId;
      if (input.lastSourceId) row.lastSourceId = input.lastSourceId;
      await this.enquiries.save(row);
      if (input.stageId) {
        await this.changeStage(
          row.id,
          {
            stageId: input.stageId,
            lostReasonId: input.lostReasonId,
            competitorId: input.competitorId,
          },
          actorId,
        );
      }
    }
    return { updated: rows.length };
  }

  private applyFilters(
    qb: ReturnType<typeof this.enquiries.createQueryBuilder>,
    filters: {
      search?: string;
      stageId?: string;
      ownerUserId?: string;
      sourceId?: string;
      status?: string;
      idleDays?: number;
    },
  ) {
    const status = filters.status || "open";
    if (status === "open") {
      qb.andWhere("stage.kind = :openKind", { openKind: EnquiryStageKind.OPEN });
    } else if (status === "lost") {
      qb.andWhere("stage.kind = :lostKind", { lostKind: EnquiryStageKind.LOST });
    } else if (status === "converted") {
      qb.andWhere("stage.kind = :convertedKind", {
        convertedKind: EnquiryStageKind.CONVERTED,
      });
    }

    if (filters.stageId) qb.andWhere("enquiry.currentStageId = :stageId", { stageId: filters.stageId });
    if (filters.ownerUserId) {
      qb.andWhere("enquiry.ownerUserId = :ownerUserId", {
        ownerUserId: filters.ownerUserId,
      });
    }
    if (filters.sourceId) {
      qb.andWhere(
        "(enquiry.firstSourceId = :sourceId OR enquiry.lastSourceId = :sourceId)",
        { sourceId: filters.sourceId },
      );
    }
    if (filters.search) {
      qb.andWhere(
        "(enquiry.studentFullName ILIKE :q OR enquiry.guardianFullName ILIKE :q OR enquiry.guardianEmail ILIKE :q OR enquiry.school ILIKE :q)",
        { q: `%${filters.search}%` },
      );
    }
    if (filters.idleDays != null) {
      qb.andWhere("enquiry.lastStageChangedAt <= :idleSince", {
        idleSince: new Date(Date.now() - filters.idleDays * 86_400_000),
      });
    }
  }

  private async applyLost(
    enquiry: Enquiry,
    stage: EnquiryStage,
    input: {
      lostReasonId?: string | null;
      competitorId?: string | null;
      flagForReengagement?: boolean;
      note?: string | null;
    },
    actorId: string,
  ) {
    if (!input.lostReasonId) {
      throw new AppError(400, "A lost reason is required", "LOST_REASON_REQUIRED");
    }
    const reason = await this.reasons.findOne({
      where: { id: input.lostReasonId },
    });
    if (!reason || reason.retiredAt) {
      throw new AppError(400, "Lost reason not found", "LOST_REASON_NOT_FOUND");
    }
    if (reason.stageId !== enquiry.currentStageId && enquiry.currentStage) {
      // Reasons depend on the stage they were lost at.
      if (reason.stageId !== enquiry.currentStage.id) {
        throw new AppError(
          400,
          "Choose a lost reason for the current stage",
          "LOST_REASON_STAGE_MISMATCH",
        );
      }
    }
    if (reason.requiresCompetitor && !input.competitorId) {
      throw new AppError(
        400,
        "Choose which centre they went to",
        "COMPETITOR_REQUIRED",
      );
    }

    const fromId = enquiry.currentStageId;
    const leavingWaiting = this.isOnWaitingList(enquiry);
    if (leavingWaiting) this.clearWaitingListMembership(enquiry);
    this.assignStage(enquiry, stage);
    enquiry.lostReasonId = reason.id;
    enquiry.competitorId = input.competitorId || null;
    enquiry.flagForReengagement = Boolean(input.flagForReengagement);
    enquiry.closedAt = new Date();
    enquiry.lastStageChangedAt = enquiry.closedAt;
    await this.enquiries.save(enquiry);
    if (leavingWaiting) await this.recompactWaitingList();
    await this.writeHistory(
      enquiry.id,
      fromId,
      stage.id,
      actorId,
      reason.id,
      input.competitorId || null,
      input.note ?? null,
    );
    await this.writeEvent(enquiry.id, "LOST", `Lost: ${reason.name}`, actorId);
  }

  private isOnWaitingList(enquiry: Enquiry) {
    return enquiry.currentStage?.code === "waiting_list";
  }

  private clearWaitingListMembership(enquiry: Enquiry) {
    enquiry.waitingListPosition = null;
    if (enquiry.nurtureState === EnquiryNurtureState.WAITING_LIST) {
      enquiry.nurtureState = EnquiryNurtureState.NONE;
    }
  }

  private async withWaitingListLock<T>(
    work: (
      enquiryRepo: Repository<Enquiry>,
      stageRepo: Repository<EnquiryStage>,
    ) => Promise<T>,
  ): Promise<T> {
    return AppDataSource.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock($1)", [WAITING_LIST_LOCK_KEY]);
      return work(
        manager.getRepository(Enquiry),
        manager.getRepository(EnquiryStage),
      );
    });
  }

  /** Append to the waiting-list tail (1…n) and persist inside the queue lock. */
  private async saveJoiningWaitingList(enquiry: Enquiry) {
    await this.withWaitingListLock(async (enquiryRepo, stageRepo) => {
      const waiting = await stageRepo.findOne({ where: { code: "waiting_list" } });
      if (!waiting) {
        throw new AppError(500, "Stage waiting_list is missing", "STAGES_MISSING");
      }
      const raw = await enquiryRepo
        .createQueryBuilder("e")
        .select("COALESCE(MAX(e.waitingListPosition), 0)", "max")
        .where("e.currentStageId = :stageId", { stageId: waiting.id })
        .andWhere("e.closedAt IS NULL")
        .getRawOne<{ max: string }>();
      enquiry.currentStageId = waiting.id;
      enquiry.currentStage = waiting;
      enquiry.waitingListPosition = Number(raw?.max ?? 0) + 1;
      enquiry.nurtureState = EnquiryNurtureState.WAITING_LIST;
      await enquiryRepo.save(enquiry);
    });
  }

  /** Renumber open waiting-list enquiries to contiguous 1…n by current order. */
  private async recompactWaitingList() {
    await this.withWaitingListLock(async (enquiryRepo, stageRepo) => {
      const waiting = await stageRepo.findOne({ where: { code: "waiting_list" } });
      if (!waiting) return;

      const rows = await enquiryRepo.find({
        where: { currentStageId: waiting.id, closedAt: IsNull() },
        order: {
          waitingListPosition: "ASC",
          lastStageChangedAt: "ASC",
          createdAt: "ASC",
        },
      });

      let position = 1;
      for (const row of rows) {
        if (row.waitingListPosition !== position) {
          row.waitingListPosition = position;
          await enquiryRepo.save(row);
        }
        position += 1;
      }
    });
  }

  private async requireEnquiry(id: string) {
    const enquiry = await this.enquiries.findOne({
      where: { id },
      relations: ENQUIRY_RELATIONS,
    });
    if (!enquiry) throw new AppError(404, "Enquiry not found", "ENQUIRY_NOT_FOUND");
    return enquiry;
  }

  private async requireOpen(id: string) {
    const enquiry = await this.requireEnquiry(id);
    if (enquiry.closedAt || enquiry.currentStage.kind !== EnquiryStageKind.OPEN) {
      throw new AppError(
        400,
        "This enquiry is closed. A returning family needs a new linked enquiry",
        "ENQUIRY_CLOSED",
      );
    }
    return enquiry;
  }

  private async requireStageByCode(code: string) {
    const stage = await this.stages.findOne({ where: { code } });
    if (!stage) throw new AppError(500, `Stage ${code} is missing`, "STAGES_MISSING");
    return stage;
  }

  private assignStage(enquiry: Enquiry, stage: EnquiryStage, at = new Date()) {
    enquiry.currentStageId = stage.id;
    enquiry.currentStage = stage;
    enquiry.lastStageChangedAt = at;
  }

  private async writeHistory(
    enquiryId: string,
    fromStageId: string | null,
    toStageId: string,
    actorUserId: string | null,
    lostReasonId: string | null = null,
    competitorId: string | null = null,
    note: string | null = null,
  ) {
    await this.history.save(
      this.history.create({
        enquiryId,
        fromStageId,
        toStageId,
        actorUserId,
        lostReasonId,
        competitorId,
        note,
      }),
    );
  }

  private async writeEvent(
    enquiryId: string,
    kind: string,
    body: string,
    actorUserId: string | null,
  ) {
    await this.events.save(
      this.events.create({ enquiryId, kind, body, actorUserId }),
    );
  }
}

export const adminEnquiriesService = new AdminEnquiriesService();
type AdminEnrollmentsService = typeof adminEnrollmentsService;
