import { In } from "typeorm";
import { AppDataSource } from "../../../config/data-source.js";
import {
  AttendanceRecord,
  AttendanceStatus,
  Session,
  Holiday,
  Enquiry,
  EnquiryStage,
  EnquiryStageHistory,
  EnquirySource,
  EnquiryLossReason,
  Class,
  Assessment,
  AssessmentSubmission,
  AssessmentStudent,
  Homework,
  HomeworkSubmission,
  HomeworkStudent,
  User,
  Subject,
  YearLevel,
  Term,
} from "../../../entities/index.js";
import { writeAuditLog } from "../../../common/utils/audit-log.js";
import type { ReportQueryInput } from "./admin-reports.validation.js";

function csvEscape(val: unknown): string {
  if (val === null || val === undefined) return '""';
  const str = String(val);
  return `"${str.replace(/"/g, '""')}"`;
}

export class AdminReportsService {
  private async resolveSubjectFilter(subjectParam?: string): Promise<{ id?: string; name?: string } | null> {
    if (!subjectParam) return null;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subjectParam);
    if (isUuid) {
      const subject = await AppDataSource.getRepository(Subject).findOne({ where: { id: subjectParam } });
      return { id: subjectParam, name: subject?.name };
    } else {
      const subject = await AppDataSource.getRepository(Subject).findOne({ where: { name: subjectParam } });
      return { id: subject?.id, name: subjectParam };
    }
  }

  async getAttendanceReport(filters: ReportQueryInput) {
    const threshold = filters.threshold ?? 80;
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;

    const holidayQuery =
      AppDataSource.getRepository(Holiday).createQueryBuilder("h");
    if (filters.dateFrom && filters.dateTo) {
      holidayQuery.where("h.startDate <= :dateTo AND h.endDate >= :dateFrom", {
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
      });
    }
    const holidays = await holidayQuery.getMany();
    const holidayDateRanges = holidays.map((h) => ({
      start: h.startDate,
      end: h.endDate,
    }));

    const query = AppDataSource.getRepository(AttendanceRecord)
      .createQueryBuilder("ar")
      .innerJoinAndSelect("ar.session", "s")
      .innerJoinAndSelect("ar.student", "u")
      .leftJoinAndSelect("s.class", "c")
      .leftJoinAndSelect("c.teacher", "ct")
      .leftJoinAndSelect("s.assessment", "a");

    if (filters.dateFrom) {
      query.andWhere("s.startAt >= :dateFrom", {
        dateFrom: `${filters.dateFrom}T00:00:00Z`,
      });
    }
    if (filters.dateTo) {
      query.andWhere("s.startAt <= :dateTo", {
        dateTo: `${filters.dateTo}T23:59:59Z`,
      });
    }
    if (filters.subjectId) {
      const resolved = await this.resolveSubjectFilter(filters.subjectId);
      const subName = resolved?.name || filters.subjectId;
      query.andWhere("c.subject = :subjectName", {
        subjectName: subName,
      });
    }
    if (filters.termId) {
      query.andWhere("c.termId = :termId", { termId: filters.termId });
    }
    if (filters.teacherId) {
      query.andWhere(
        "(s.teacherId = :teacherId OR (s.teacherId IS NULL AND c.teacher = :teacherId))",
        {
          teacherId: filters.teacherId,
        },
      );
    }

    const records = await query.getMany();

    // Filter out records on holidays
    const validRecords = records.filter((r) => {
      const sessionDateStr = r.session.startAt.toISOString().slice(0, 10);
      const isHoliday = holidayDateRanges.some(
        (h) => sessionDateStr >= h.start && sessionDateStr <= h.end,
      );
      return !isHoliday;
    });

    let totalPresent = 0;
    let totalLate = 0;
    let totalAbsent = 0;
    let totalExcused = 0;
    let totalExceptions = 0;
    let inGraceWindow = 0;

    const studentMap = new Map<
      string,
      {
        studentId: string;
        fullName: string;
        email: string | null;
        total: number;
        present: number;
        late: number;
        absent: number;
        excused: number;
      }
    >();

    const subjectMap = new Map<
      string,
      {
        subject: string;
        total: number;
        present: number;
        absent: number;
        late: number;
      }
    >();

    for (const r of validRecords) {
      const status = r.status;
      if (status === AttendanceStatus.PRESENT) totalPresent++;
      else if (status === AttendanceStatus.LATE) totalLate++;
      else if (status === AttendanceStatus.ABSENT) totalAbsent++;
      else if (status === AttendanceStatus.EXCUSED) totalExcused++;
      else if (status === AttendanceStatus.EXCEPTION) totalExceptions++;

      if (r.scannedAt && r.session.startAt) {
        const diffMins =
          (r.scannedAt.getTime() - r.session.startAt.getTime()) / 60000;
        if (diffMins > 0 && diffMins <= (r.session.gracePeriodMinutes || 25)) {
          inGraceWindow++;
        }
      }

      const sId = r.studentId;
      if (!studentMap.has(sId)) {
        studentMap.set(sId, {
          studentId: sId,
          fullName: r.student.fullName,
          email: r.student.email,
          total: 0,
          present: 0,
          late: 0,
          absent: 0,
          excused: 0,
        });
      }
      const st = studentMap.get(sId)!;
      st.total++;
      if (status === AttendanceStatus.PRESENT) st.present++;
      else if (status === AttendanceStatus.LATE) st.late++;
      else if (status === AttendanceStatus.ABSENT) st.absent++;
      else if (status === AttendanceStatus.EXCUSED) st.excused++;

      const subjectName =
        r.session.class?.name || r.session.assessment?.subject || "General";
      if (!subjectMap.has(subjectName)) {
        subjectMap.set(subjectName, {
          subject: subjectName,
          total: 0,
          present: 0,
          absent: 0,
          late: 0,
        });
      }
      const sm = subjectMap.get(subjectName)!;
      sm.total++;
      if (status === AttendanceStatus.PRESENT) sm.present++;
      else if (status === AttendanceStatus.LATE) sm.late++;
      else if (status === AttendanceStatus.ABSENT) sm.absent++;
    }

    const totalCalculated =
      totalPresent + totalLate + totalAbsent + totalExcused;
    const overallRate =
      totalCalculated > 0
        ? ((totalPresent + totalLate) / totalCalculated) * 100
        : 100;

    const studentRows = Array.from(studentMap.values()).map((s) => {
      const activeTotal = s.present + s.late + s.absent + s.excused;
      const rate =
        activeTotal > 0 ? ((s.present + s.late) / activeTotal) * 100 : 100;
      return {
        studentId: s.studentId,
        studentName: s.fullName,
        email: s.email,
        totalSessions: s.total,
        present: s.present,
        late: s.late,
        absent: s.absent,
        excused: s.excused,
        attendanceRate: Math.round(rate * 10) / 10,
        isBelowThreshold: rate < threshold,
      };
    });

    studentRows.sort((a, b) => a.attendanceRate - b.attendanceRate);

    const totalStudentsBelow = studentRows.filter(
      (s) => s.isBelowThreshold,
    ).length;
    const totalStudents = studentRows.length;
    const paginatedStudents = studentRows.slice(
      (page - 1) * limit,
      page * limit,
    );

    const subjectBreakdown = Array.from(subjectMap.values()).map((s) => ({
      subject: s.subject,
      totalSessions: s.total,
      present: s.present,
      absent: s.absent,
      late: s.late,
      attendanceRate:
        s.total > 0
          ? Math.round(((s.present + s.late) / s.total) * 1000) / 10
          : 100,
    }));

    return {
      summary: {
        overallAttendanceRate: Math.round(overallRate * 10) / 10,
        totalRecords: validRecords.length,
        totalPresent,
        totalLate,
        totalAbsent,
        totalExcused,
        totalExceptions,
        inGraceWindow,
        studentsBelowThreshold: totalStudentsBelow,
        threshold,
        totalStudents,
      },
      subjectBreakdown,
      students: {
        items: paginatedStudents,
        total: totalStudents,
        page,
        limit,
        totalPages: Math.ceil(totalStudents / limit) || 1,
      },
      filtersApplied: filters,
      lastUpdated: new Date().toISOString(),
    };
  }

  async getEnquiryFunnelReport(filters: ReportQueryInput) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const touchPoint = filters.touchPoint ?? "first";

    const stages = await AppDataSource.getRepository(EnquiryStage)
      .createQueryBuilder("st")
      .orderBy("st.sortOrder", "ASC")
      .getMany();

    const historyQuery = AppDataSource.getRepository(EnquiryStageHistory)
      .createQueryBuilder("h")
      .innerJoinAndSelect("h.toStage", "ts")
      .innerJoinAndSelect("h.enquiry", "e")
      .leftJoinAndSelect("e.firstSource", "fs")
      .leftJoinAndSelect("e.lastSource", "ls")
      .leftJoinAndSelect("h.lostReason", "lr");

    if (filters.dateFrom) {
      historyQuery.andWhere("h.createdAt >= :dateFrom", {
        dateFrom: `${filters.dateFrom}T00:00:00Z`,
      });
    }
    if (filters.dateTo) {
      historyQuery.andWhere("h.createdAt <= :dateTo", {
        dateTo: `${filters.dateTo}T23:59:59Z`,
      });
    }

    const histories = await historyQuery.getMany();

    const stageEnquiriesMap = new Map<string, Set<string>>();
    for (const st of stages) {
      stageEnquiriesMap.set(st.id, new Set());
    }

    for (const h of histories) {
      if (stageEnquiriesMap.has(h.toStageId)) {
        stageEnquiriesMap.get(h.toStageId)!.add(h.enquiryId);
      }
    }

    const firstStageId = stages[0]?.id;
    const baseCount = firstStageId
      ? (stageEnquiriesMap.get(firstStageId)?.size ?? 0)
      : 0;

    const funnelStages = stages.map((st, index) => {
      const count = stageEnquiriesMap.get(st.id)?.size ?? 0;
      const prevCount =
        index > 0
          ? (stageEnquiriesMap.get(stages[index - 1].id)?.size ?? 0)
          : count;
      const stepConversion =
        prevCount > 0 ? Math.round((count / prevCount) * 1000) / 10 : 0;
      const overallConversion =
        baseCount > 0 ? Math.round((count / baseCount) * 1000) / 10 : 0;

      return {
        stageId: st.id,
        stageName: st.name,
        code: st.code,
        count,
        stepConversionRate: stepConversion,
        overallConversionRate: overallConversion,
      };
    });

    const lostReasons =
      await AppDataSource.getRepository(EnquiryLossReason).find();
    const lostReasonCountMap = new Map<string, number>();
    for (const h of histories) {
      if (h.lostReasonId) {
        lostReasonCountMap.set(
          h.lostReasonId,
          (lostReasonCountMap.get(h.lostReasonId) ?? 0) + 1,
        );
      }
    }

    const lostReasonBreakdown = lostReasons
      .map((lr) => ({
        reasonId: lr.id,
        reasonName: lr.name,
        count: lostReasonCountMap.get(lr.id) ?? 0,
      }))
      .filter((lr) => lr.count > 0);

    const sources = await AppDataSource.getRepository(EnquirySource).find();
    const sourceStatsMap = new Map<
      string,
      {
        sourceId: string;
        sourceName: string;
        totalEnquiries: number;
        trialsBooked: number;
        enrolled: number;
      }
    >();

    for (const s of sources) {
      sourceStatsMap.set(s.id, {
        sourceId: s.id,
        sourceName: s.name,
        totalEnquiries: 0,
        trialsBooked: 0,
        enrolled: 0,
      });
    }

    const enquiryQuery = AppDataSource.getRepository(Enquiry)
      .createQueryBuilder("e")
      .leftJoinAndSelect("e.firstSource", "fs")
      .leftJoinAndSelect("e.lastSource", "ls")
      .leftJoinAndSelect("e.currentStage", "cs");

    if (filters.dateFrom) {
      enquiryQuery.andWhere("e.createdAt >= :dateFrom", {
        dateFrom: `${filters.dateFrom}T00:00:00Z`,
      });
    }
    if (filters.dateTo) {
      enquiryQuery.andWhere("e.createdAt <= :dateTo", {
        dateTo: `${filters.dateTo}T23:59:59Z`,
      });
    }

    const allEnquiries = await enquiryQuery.getMany();

    for (const e of allEnquiries) {
      const sourceId = touchPoint === "last" ? e.lastSourceId : e.firstSourceId;
      if (sourceId && sourceStatsMap.has(sourceId)) {
        const stat = sourceStatsMap.get(sourceId)!;
        stat.totalEnquiries++;
        if (e.trialConfirmed || e.trialAttended) stat.trialsBooked++;
        if (e.convertedEnrollmentId) stat.enrolled++;
      }
    }

    const sourceAttribution = Array.from(sourceStatsMap.values()).map((s) => ({
      sourceId: s.sourceId,
      sourceName: s.sourceName,
      totalEnquiries: s.totalEnquiries,
      trialsBooked: s.trialsBooked,
      enrolled: s.enrolled,
      conversionRate:
        s.totalEnquiries > 0
          ? Math.round((s.enrolled / s.totalEnquiries) * 1000) / 10
          : 0,
    }));

    const paginatedEnquiries = allEnquiries
      .slice((page - 1) * limit, page * limit)
      .map((e) => ({
        id: e.id,
        studentFullName: e.studentFullName,
        guardianFullName: e.guardianFullName,
        guardianEmail: e.guardianEmail,
        guardianMobile: e.guardianMobile,
        currentStage: e.currentStage?.name ?? "Unknown",
        firstSource: e.firstSource?.name ?? "Unknown",
        lastSource: e.lastSource?.name ?? "Unknown",
        createdAt: e.createdAt,
      }));

    return {
      summary: {
        totalEnquiriesInPeriod: allEnquiries.length,
        touchPoint,
        totalConverted: allEnquiries.filter((e) => e.convertedEnrollmentId)
          .length,
        overallConversionRate:
          allEnquiries.length > 0
            ? Math.round(
                (allEnquiries.filter((e) => e.convertedEnrollmentId).length /
                  allEnquiries.length) *
                  1000,
              ) / 10
            : 0,
      },
      funnelStages,
      lostReasonBreakdown,
      sourceAttribution,
      enquiries: {
        items: paginatedEnquiries,
        total: allEnquiries.length,
        page,
        limit,
        totalPages: Math.ceil(allEnquiries.length / limit) || 1,
      },
      lastUpdated: new Date().toISOString(),
    };
  }

  async getClassesSessionsReport(filters: ReportQueryInput) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;

    const query = AppDataSource.getRepository(Session)
      .createQueryBuilder("s")
      .leftJoinAndSelect("s.class", "c")
      .leftJoinAndSelect("s.classroom", "cr")
      .leftJoinAndSelect("s.teacher", "st")
      .leftJoinAndSelect("c.teacher", "ct")
      .leftJoinAndSelect("s.assessment", "a");

    if (filters.dateFrom) {
      query.andWhere("s.startAt >= :dateFrom", {
        dateFrom: `${filters.dateFrom}T00:00:00Z`,
      });
    }
    if (filters.dateTo) {
      query.andWhere("s.startAt <= :dateTo", {
        dateTo: `${filters.dateTo}T23:59:59Z`,
      });
    }
    if (filters.termId) {
      query.andWhere("c.termId = :termId", { termId: filters.termId });
    }
    if (filters.subjectId) {
      const resolved = await this.resolveSubjectFilter(filters.subjectId);
      const subName = resolved?.name || filters.subjectId;
      query.andWhere("c.subject = :subName", { subName });
    }

    const sessions = await query.orderBy("s.startAt", "DESC").getMany();

    const holidayQuery =
      AppDataSource.getRepository(Holiday).createQueryBuilder("h");
    if (filters.dateFrom && filters.dateTo) {
      holidayQuery.where("h.startDate <= :dateTo AND h.endDate >= :dateFrom", {
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
      });
    }
    const holidays = await holidayQuery.getMany();
    const holidayRanges = holidays.map((h) => ({
      start: h.startDate,
      end: h.endDate,
    }));

    let totalScheduled = 0;
    let totalCompleted = 0;
    let totalHolidayAffected = 0;
    let missingTeacherGaps = 0;
    let missingRoomGaps = 0;
    let teacherOverrides = 0;

    const now = new Date();

    const sessionItems = sessions.map((s) => {
      const dateStr = s.startAt.toISOString().slice(0, 10);
      const isHoliday = holidayRanges.some(
        (h) => dateStr >= h.start && dateStr <= h.end,
      );
      const isCompleted = s.endAt < now;
      const assignedTeacherId = s.teacherId || s.class?.teacher?.id;
      const isTeacherGap = !assignedTeacherId;
      const isRoomGap = !s.classroomId && !s.room;
      const isTeacherOverride = Boolean(
        s.teacherId &&
        s.class?.teacher?.id &&
        s.teacherId !== s.class.teacher.id,
      );

      totalScheduled++;
      if (isHoliday) totalHolidayAffected++;
      if (isCompleted && !isHoliday) totalCompleted++;
      if (isTeacherGap) missingTeacherGaps++;
      if (isRoomGap) missingRoomGaps++;
      if (isTeacherOverride) teacherOverrides++;

      return {
        id: s.id,
        className: s.class?.name || s.assessment?.name || "Session",
        classCode: s.class?.code,
        startAt: s.startAt,
        endAt: s.endAt,
        room: s.classroom?.name || s.room || "Unassigned",
        teacherName:
          s.teacher?.fullName || s.class?.teacher?.fullName || "Unassigned",
        isHoliday,
        isCompleted,
        isTeacherGap,
        isRoomGap,
        isTeacherOverride,
      };
    });

    const paginated = sessionItems.slice((page - 1) * limit, page * limit);

    return {
      summary: {
        totalScheduled,
        totalCompleted,
        totalHolidayAffected,
        missingTeacherGaps,
        missingRoomGaps,
        teacherOverrides,
      },
      sessions: {
        items: paginated,
        total: sessionItems.length,
        page,
        limit,
        totalPages: Math.ceil(sessionItems.length / limit) || 1,
      },
      lastUpdated: new Date().toISOString(),
    };
  }

  async getAssessmentsReport(filters: ReportQueryInput) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;

    const query = AppDataSource.getRepository(Assessment)
      .createQueryBuilder("a")
      .leftJoinAndSelect("a.term", "t")
      .leftJoinAndSelect("a.teacher", "u")
      .leftJoinAndSelect("a.students", "ast")
      .leftJoinAndSelect("a.linkedClass", "c");

    if (filters.dateFrom) {
      query.andWhere("a.assessmentDate >= :dateFrom", {
        dateFrom: filters.dateFrom,
      });
    }
    if (filters.dateTo) {
      query.andWhere("a.assessmentDate <= :dateTo", { dateTo: filters.dateTo });
    }
    if (filters.termId) {
      query.andWhere("a.termId = :termId", { termId: filters.termId });
    }
    if (filters.subjectId) {
      const resolved = await this.resolveSubjectFilter(filters.subjectId);
      const subName = resolved?.name || filters.subjectId;
      query.andWhere("a.subject = :subName", { subName });
    }
    if (filters.teacherId) {
      query.andWhere("a.teacherId = :teacherId", {
        teacherId: filters.teacherId,
      });
    }

    const assessments = await query
      .orderBy("a.assessmentDate", "DESC")
      .getMany();

    const assessmentIds = assessments.map((a) => a.id);
    const submissions =
      assessmentIds.length > 0
        ? await AppDataSource.getRepository(AssessmentSubmission).find({
            where: { assessmentId: In(assessmentIds) },
            relations: { student: true },
          })
        : [];

    const subMap = new Map<string, AssessmentSubmission[]>();
    for (const sub of submissions) {
      if (!subMap.has(sub.assessmentId)) subMap.set(sub.assessmentId, []);
      subMap.get(sub.assessmentId)!.push(sub);
    }

    let totalEntrance = 0;
    let totalSchool = 0;
    let totalCandidates = 0;
    let totalSubmissionsCount = 0;

    const items = assessments.map((a) => {
      if (a.kind === "ENTRANCE") totalEntrance++;
      else totalSchool++;

      const candCount = a.students?.length ?? 0;
      totalCandidates += candCount;

      const aSubs = subMap.get(a.id) ?? [];
      totalSubmissionsCount += aSubs.length;

      const scoredSubs = aSubs.filter((s) => s.mark != null);
      const avgMark =
        scoredSubs.length > 0
          ? scoredSubs.reduce((acc, s) => acc + Number(s.mark), 0) /
            scoredSubs.length
          : null;

      return {
        id: a.id,
        name: a.name,
        kind: a.kind,
        scheduleType: a.scheduleType,
        assessmentDate: a.assessmentDate,
        startTime: a.startTime,
        subject: a.subject,
        yearGroup: a.yearGroup,
        teacherName: a.teacher?.fullName || "Unassigned",
        status: a.status,
        candidatesCount: candCount,
        submissionsCount: aSubs.length,
        averageMark: avgMark ? Math.round(avgMark * 10) / 10 : null,
        totalMarks: a.totalMarks ? Number(a.totalMarks) : null,
      };
    });

    const paginated = items.slice((page - 1) * limit, page * limit);

    return {
      summary: {
        totalAssessments: assessments.length,
        totalSchool,
        totalEntrance,
        totalCandidates,
        totalSubmissions: totalSubmissionsCount,
      },
      assessments: {
        items: paginated,
        total: items.length,
        page,
        limit,
        totalPages: Math.ceil(items.length / limit) || 1,
      },
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * 5. Homework Report
   */
  async getHomeworkReport(filters: ReportQueryInput) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;

    const query = AppDataSource.getRepository(Homework)
      .createQueryBuilder("hw")
      .leftJoinAndSelect("hw.term", "t")
      .leftJoinAndSelect("hw.subject", "sub")
      .leftJoinAndSelect("hw.createdBy", "u")
      .leftJoinAndSelect("hw.students", "hs")
      .leftJoinAndSelect("hw.submissions", "hsub");

    if (filters.dateFrom) {
      query.andWhere("hw.dueDate >= :dateFrom", { dateFrom: filters.dateFrom });
    }
    if (filters.dateTo) {
      query.andWhere("hw.dueDate <= :dateTo", { dateTo: filters.dateTo });
    }
    if (filters.termId) {
      query.andWhere("hw.termId = :termId", { termId: filters.termId });
    }
    if (filters.subjectId) {
      const resolved = await this.resolveSubjectFilter(filters.subjectId);
      if (resolved?.id) {
        query.andWhere("hw.subjectId = :subjectUuid", {
          subjectUuid: resolved.id,
        });
      } else if (resolved?.name) {
        query.andWhere("sub.name = :subjectName", {
          subjectName: resolved.name,
        });
      } else {
        query.andWhere("hw.subjectId = :subjectId", {
          subjectId: filters.subjectId,
        });
      }
    }

    const homeworks = await query.orderBy("hw.dueDate", "DESC").getMany();

    let totalAssignedTasks = homeworks.length;
    let totalAssignedStudents = 0;
    let totalSubmissions = 0;
    let totalPendingMarking = 0;

    const subjectBreakdownMap = new Map<
      string,
      { subject: string; tasks: number; submissions: number }
    >();

    const items = homeworks.map((hw) => {
      const studentCount = hw.students?.length ?? 0;
      totalAssignedStudents += studentCount;

      const subs = hw.submissions ?? [];
      totalSubmissions += subs.length;

      const pendingMark = subs.filter(
        (s) => s.status === "SUBMITTED" && s.markedAt == null,
      ).length;
      totalPendingMarking += pendingMark;

      const subName = hw.subject?.name || "General";
      if (!subjectBreakdownMap.has(subName)) {
        subjectBreakdownMap.set(subName, {
          subject: subName,
          tasks: 0,
          submissions: 0,
        });
      }
      const sm = subjectBreakdownMap.get(subName)!;
      sm.tasks++;
      sm.submissions += subs.length;

      return {
        id: hw.id,
        title: hw.title,
        subject: hw.subject?.name || "General",
        yearGroup: hw.yearGroup,
        dueDate: hw.dueDate,
        teacherName: hw.createdBy?.fullName || "Unknown",
        assignedStudentsCount: studentCount,
        submissionsCount: subs.length,
        pendingMarkingCount: pendingMark,
      };
    });

    const paginated = items.slice((page - 1) * limit, page * limit);
    const subjectBreakdown = Array.from(subjectBreakdownMap.values());

    return {
      summary: {
        totalAssignedTasks,
        totalAssignedStudents,
        totalSubmissions,
        totalPendingMarking,
        submissionRate:
          totalAssignedStudents > 0
            ? Math.round((totalSubmissions / totalAssignedStudents) * 1000) / 10
            : 0,
      },
      subjectBreakdown,
      homework: {
        items: paginated,
        total: items.length,
        page,
        limit,
        totalPages: Math.ceil(items.length / limit) || 1,
      },
      lastUpdated: new Date().toISOString(),
    };
  }

  async exportReportCsv(
    tab: string,
    filters: ReportQueryInput,
    user: { id: string; fullName: string },
  ) {
    let csvContent = "";
    let recordCount = 0;
    const filename = `report_${tab}_${new Date().toISOString().slice(0, 10)}.csv`;

    if (tab === "attendance") {
      const data = await this.getAttendanceReport({ ...filters, limit: 10000 });
      recordCount = data.students.total;
      csvContent = [
        "Student Name,Email,Total Sessions,Present,Late,Absent,Excused,Attendance Rate (%),Below Threshold",
        ...data.students.items.map(
          (s) =>
            `${csvEscape(s.studentName)},${csvEscape(s.email)},${csvEscape(s.totalSessions)},${csvEscape(s.present)},${csvEscape(s.late)},${csvEscape(s.absent)},${csvEscape(s.excused)},${csvEscape(`${s.attendanceRate}%`)},${csvEscape(s.isBelowThreshold ? "YES" : "NO")}`,
        ),
      ].join("\n");
    } else if (tab === "enquiries") {
      const data = await this.getEnquiryFunnelReport({
        ...filters,
        limit: 10000,
      });
      recordCount = data.enquiries.total;
      csvContent = [
        "Student Name,Guardian Name,Guardian Email,Guardian Mobile,Current Stage,First Source,Last Source,Created At",
        ...data.enquiries.items.map(
          (e) =>
            `${csvEscape(e.studentFullName)},${csvEscape(e.guardianFullName)},${csvEscape(e.guardianEmail)},${csvEscape(e.guardianMobile)},${csvEscape(e.currentStage)},${csvEscape(e.firstSource)},${csvEscape(e.lastSource)},${csvEscape(e.createdAt)}`,
        ),
      ].join("\n");
    } else if (tab === "classes") {
      const data = await this.getClassesSessionsReport({
        ...filters,
        limit: 10000,
      });
      recordCount = data.sessions.total;
      csvContent = [
        "Class Name,Start At,End At,Room,Teacher,Is Holiday,Is Completed,Teacher Gap,Room Gap",
        ...data.sessions.items.map(
          (s) =>
            `${csvEscape(s.className)},${csvEscape(s.startAt)},${csvEscape(s.endAt)},${csvEscape(s.room)},${csvEscape(s.teacherName)},${csvEscape(s.isHoliday ? "YES" : "NO")},${csvEscape(s.isCompleted ? "YES" : "NO")},${csvEscape(s.isTeacherGap ? "YES" : "NO")},${csvEscape(s.isRoomGap ? "YES" : "NO")}`,
        ),
      ].join("\n");
    } else if (tab === "assessments") {
      const data = await this.getAssessmentsReport({
        ...filters,
        limit: 10000,
      });
      recordCount = data.assessments.total;
      csvContent = [
        "Assessment Name,Kind,Schedule Type,Date,Subject,Year Group,Teacher,Status,Candidates,Submissions,Average Mark",
        ...data.assessments.items.map(
          (a) =>
            `${csvEscape(a.name)},${csvEscape(a.kind)},${csvEscape(a.scheduleType)},${csvEscape(a.assessmentDate)},${csvEscape(a.subject)},${csvEscape(a.yearGroup)},${csvEscape(a.teacherName)},${csvEscape(a.status)},${csvEscape(a.candidatesCount)},${csvEscape(a.submissionsCount)},${csvEscape(a.averageMark ?? "N/A")}`,
        ),
      ].join("\n");
    } else if (tab === "homework") {
      const data = await this.getHomeworkReport({ ...filters, limit: 10000 });
      recordCount = data.homework.total;
      csvContent = [
        "Homework Title,Subject,Year Group,Due Date,Teacher,Assigned Students,Submissions,Pending Marking",
        ...data.homework.items.map(
          (h) =>
            `${csvEscape(h.title)},${csvEscape(h.subject)},${csvEscape(h.yearGroup)},${csvEscape(h.dueDate)},${csvEscape(h.teacherName)},${csvEscape(h.assignedStudentsCount)},${csvEscape(h.submissionsCount)},${csvEscape(h.pendingMarkingCount)}`,
        ),
      ].join("\n");
    }

    await writeAuditLog({
      actorUserId: user.id,
      actorName: user.fullName,
      action: "EXPORTED",
      recordType: "report_export",
      recordLabel: `Exported ${tab} report (${recordCount} records)`,
      after: {
        tab,
        filters,
        recordCount,
        exportedAt: new Date().toISOString(),
      },
    });

    return { csvContent, filename, recordCount };
  }
}

export const adminReportsService = new AdminReportsService();
