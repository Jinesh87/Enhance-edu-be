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
  Student,
  GuardianStudent,
} from "../../../entities/index.js";
import { writeAuditLog } from "../../../common/utils/audit-log.js";
import { emailService } from "../../email/email.service.js";
import type { ReportQueryInput, NotifyGuardianInput } from "./admin-reports.validation.js";

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
    const threshold =
      filters.threshold !== undefined && filters.threshold !== null
        ? Number(filters.threshold)
        : 80;
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
      .leftJoinAndSelect("c.term", "cterm")
      .leftJoinAndSelect("cterm.academicYear", "cay")
      .leftJoinAndSelect("cterm.yearLevel", "cyl")
      .leftJoinAndSelect("c.teacher", "ct")
      .leftJoinAndSelect("s.teacher", "st")
      .leftJoinAndSelect("s.classroom", "sroom")
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
    if (filters.academicYear) {
      query.andWhere("(cay.year = :acadYear OR cay.displayName = :acadYearStr)", {
        acadYear: Number(filters.academicYear) || 0,
        acadYearStr: String(filters.academicYear),
      });
    }
    if (filters.academicYearId) {
      query.andWhere("cay.id = :acadYearId", { acadYearId: filters.academicYearId });
    }
    if (filters.yearGroup) {
      query.andWhere("cyl.name = :yearGroup", { yearGroup: filters.yearGroup });
    }
    if (filters.yearLevelId) {
      query.andWhere("cyl.id = :yearLevelId", { yearLevelId: filters.yearLevelId });
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
    if (filters.studentId) {
      query.andWhere("ar.studentId = :studentId", { studentId: filters.studentId });
    }
    if (filters.search && filters.search.trim()) {
      query.andWhere(
        "(LOWER(u.fullName) LIKE :search OR LOWER(u.email) LIKE :search)",
        { search: `%${filters.search.trim().toLowerCase()}%` },
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

    type StudentSessionLog = {
      sessionId: string;
      date: string;
      time: string;
      subject: string;
      teacher: string;
      room: string;
      status: string;
      scannedAt: string | null;
    };

    const studentMap = new Map<
      string,
      {
        studentId: string;
        fullName: string;
        email: string | null;
        academicYear: string | number | null;
        yearLevel: string | null;
        termName: string | null;
        total: number;
        present: number;
        late: number;
        absent: number;
        excused: number;
        sessionLogs: StudentSessionLog[];
        subjectStats: Map<
          string,
          {
            total: number;
            present: number;
            late: number;
            absent: number;
            excused: number;
            teacherName: string;
          }
        >;
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
          academicYear: null,
          yearLevel: null,
          termName: null,
          total: 0,
          present: 0,
          late: 0,
          absent: 0,
          excused: 0,
          sessionLogs: [],
          subjectStats: new Map(),
        });
      }
      const st = studentMap.get(sId)!;
      st.total++;
      if (status === AttendanceStatus.PRESENT) st.present++;
      else if (status === AttendanceStatus.LATE) st.late++;
      else if (status === AttendanceStatus.ABSENT) st.absent++;
      else if (status === AttendanceStatus.EXCUSED) st.excused++;

      if (r.session.class?.term) {
        const term = r.session.class.term;
        if (!st.academicYear && term.academicYear) {
          st.academicYear = term.academicYear.year || term.academicYear.displayName;
        }
        if (!st.yearLevel && term.yearLevel) {
          st.yearLevel = term.yearLevel.name;
        }
        if (!st.termName && term.name) {
          st.termName = term.name;
        }
      }

      const subjectName =
        r.session.class?.subject || r.session.class?.name || r.session.assessment?.subject || "General";
      const teacherName =
        r.session.teacher?.fullName || r.session.class?.teacher?.fullName || "Unassigned";
      const roomName =
        r.session.classroom?.name || r.session.room || "Main Room";
      const sessionDate = r.session.startAt ? r.session.startAt.toISOString().slice(0, 10) : "-";
      const sessionTime =
        r.session.startAt && r.session.endAt
          ? `${new Date(r.session.startAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} - ${new Date(r.session.endAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
          : "-";

      st.sessionLogs.push({
        sessionId: r.session.id,
        date: sessionDate,
        time: sessionTime,
        subject: subjectName,
        teacher: teacherName,
        room: roomName,
        status: r.status,
        scannedAt: r.scannedAt ? r.scannedAt.toISOString() : null,
      });

      if (!st.subjectStats.has(subjectName)) {
        st.subjectStats.set(subjectName, {
          total: 0,
          present: 0,
          late: 0,
          absent: 0,
          excused: 0,
          teacherName,
        });
      }
      const stSub = st.subjectStats.get(subjectName)!;
      stSub.total++;
      if (teacherName !== "Unassigned") {
        stSub.teacherName = teacherName;
      }
      if (status === AttendanceStatus.PRESENT) stSub.present++;
      else if (status === AttendanceStatus.LATE) stSub.late++;
      else if (status === AttendanceStatus.ABSENT) stSub.absent++;
      else if (status === AttendanceStatus.EXCUSED) stSub.excused++;

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

    const studentUserIds = Array.from(studentMap.keys());
    const guardianMap = new Map<
      string,
      { guardianName: string | null; guardianEmail: string | null; guardianPhone: string | null }
    >();

    if (studentUserIds.length > 0) {
      try {
        const studentEntities = await AppDataSource.getRepository(Student).find({
          where: [{ userId: In(studentUserIds) }, { id: In(studentUserIds) }],
          relations: { guardianLinks: { guardian: true } },
        });

        for (const sEnt of studentEntities) {
          const key = sEnt.userId || sEnt.id;
          const firstLink = sEnt.guardianLinks?.[0];
          if (firstLink?.guardian) {
            guardianMap.set(key, {
              guardianName: firstLink.guardian.fullName,
              guardianEmail: firstLink.guardian.email,
              guardianPhone: firstLink.guardian.mobile || null,
            });
          }
        }
      } catch {
        // Fallback gracefully
      }
    }

    const studentRows = Array.from(studentMap.values()).map((s) => {
      const activeTotal = s.present + s.late + s.absent + s.excused;
      const rate =
        activeTotal > 0 ? ((s.present + s.late) / activeTotal) * 100 : 100;

      const guardian = guardianMap.get(s.studentId);

      const subjectBreakdown = Array.from(s.subjectStats.entries()).map(([sub, stat]) => {
        const subActive = stat.present + stat.late + stat.absent + stat.excused;
        const subRate = subActive > 0 ? ((stat.present + stat.late) / subActive) * 100 : 100;
        return {
          subject: sub,
          teacherName: stat.teacherName,
          total: stat.total,
          present: stat.present,
          late: stat.late,
          absent: stat.absent,
          excused: stat.excused,
          attendanceRate: Math.round(subRate * 10) / 10,
        };
      });

      // Ascending chronological order by date (earliest first: Sep 7 -> ... -> Dec 29)
      s.sessionLogs.sort((a, b) => a.date.localeCompare(b.date));

      return {
        studentId: s.studentId,
        studentName: s.fullName,
        email: s.email,
        academicYear: s.academicYear,
        yearLevel: s.yearLevel,
        termName: s.termName,
        guardianName: guardian?.guardianName || null,
        guardianEmail: guardian?.guardianEmail || null,
        guardianPhone: guardian?.guardianPhone || null,
        totalSessions: s.total,
        present: s.present,
        late: s.late,
        absent: s.absent,
        excused: s.excused,
        attendanceRate: Math.round(rate * 10) / 10,
        isBelowThreshold: threshold > 0 ? rate < threshold : false,
        sessionLogs: s.sessionLogs,
        subjectBreakdown,
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
      .leftJoinAndSelect("c.term", "cterm")
      .leftJoinAndSelect("cterm.academicYear", "cay")
      .leftJoinAndSelect("cterm.yearLevel", "cyl")
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
    if (filters.academicYear) {
      query.andWhere("(cay.year = :acadYear OR cay.displayName = :acadYearStr)", {
        acadYear: Number(filters.academicYear) || 0,
        acadYearStr: String(filters.academicYear),
      });
    }
    if (filters.academicYearId) {
      query.andWhere("cay.id = :acadYearId", { acadYearId: filters.academicYearId });
    }
    if (filters.yearGroup) {
      query.andWhere("cyl.name = :yearGroup", { yearGroup: filters.yearGroup });
    }
    if (filters.yearLevelId) {
      query.andWhere("cyl.id = :yearLevelId", { yearLevelId: filters.yearLevelId });
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
      .leftJoinAndSelect("t.academicYear", "ay")
      .leftJoinAndSelect("t.yearLevel", "yl")
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
    if (filters.academicYear) {
      query.andWhere("(ay.year = :acadYear OR ay.displayName = :acadYearStr)", {
        acadYear: Number(filters.academicYear) || 0,
        acadYearStr: String(filters.academicYear),
      });
    }
    if (filters.academicYearId) {
      query.andWhere("ay.id = :acadYearId", { acadYearId: filters.academicYearId });
    }
    if (filters.yearGroup) {
      query.andWhere("(a.yearGroup = :yearGroup OR yl.name = :yearGroup)", {
        yearGroup: filters.yearGroup,
      });
    }
    if (filters.yearLevelId) {
      query.andWhere("yl.id = :yearLevelId", { yearLevelId: filters.yearLevelId });
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
      .leftJoinAndSelect("t.academicYear", "ay")
      .leftJoinAndSelect("t.yearLevel", "yl")
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
    if (filters.academicYear) {
      query.andWhere("(ay.year = :acadYear OR ay.displayName = :acadYearStr)", {
        acadYear: Number(filters.academicYear) || 0,
        acadYearStr: String(filters.academicYear),
      });
    }
    if (filters.academicYearId) {
      query.andWhere("ay.id = :acadYearId", { acadYearId: filters.academicYearId });
    }
    if (filters.yearGroup) {
      query.andWhere("(hw.yearGroup = :yearGroup OR yl.name = :yearGroup)", {
        yearGroup: filters.yearGroup,
      });
    }
    if (filters.yearLevelId) {
      query.andWhere("yl.id = :yearLevelId", { yearLevelId: filters.yearLevelId });
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
      const periodStr =
        filters.dateFrom && filters.dateTo
          ? `${filters.dateFrom} to ${filters.dateTo}`
          : filters.dateFrom
            ? `From ${filters.dateFrom}`
            : filters.dateTo
              ? `Up to ${filters.dateTo}`
              : "All Time";

      if (filters.studentId && data.students.items.length === 1) {
        const student = data.students.items[0];
        recordCount = student.sessionLogs?.length || 0;
        csvContent = [
          `"Enhance Education - Student Attendance Transcript",""`,
          `"Student Name",${csvEscape(student.studentName)}`,
          `"Student Email",${csvEscape(student.email || "N/A")}`,
          `"Academic Year",${csvEscape(student.academicYear || "All Years")}`,
          `"Year Level",${csvEscape(student.yearLevel || "All Levels")}`,
          `"Term",${csvEscape(student.termName || "All Terms")}`,
          `"Guardian Name",${csvEscape(student.guardianName || "N/A")}`,
          `"Guardian Phone",${csvEscape(student.guardianPhone || "N/A")}`,
          `"Guardian Email",${csvEscape(student.guardianEmail || "N/A")}`,
          `"Reporting Period",${csvEscape(periodStr)}`,
          `"Total Sessions","${student.totalSessions}"`,
          `"Attendance Rate","${student.attendanceRate}%"`,
          `""`,
          `"Date","Time","Subject","Teacher","Room","Status","Check-in Time"`,
          ...(student.sessionLogs || []).map(
            (log) =>
              `${csvEscape(log.date)},${csvEscape(log.time)},${csvEscape(log.subject)},${csvEscape(log.teacher)},${csvEscape(log.room)},${csvEscape(log.status)},${csvEscape(log.scannedAt || "N/A")}`,
          ),
        ].join("\n");
      } else {
        recordCount = data.students.total;
        csvContent = [
          `"Enhance Education - Attendance & Roll Analysis Report",""`,
          `"Generated Date",${csvEscape(new Date().toISOString().slice(0, 10))}`,
          `"Generated By",${csvEscape(user.fullName)}`,
          `"Reporting Period",${csvEscape(periodStr)}`,
          `"Academic Year",${csvEscape(String(filters.academicYear || "All Years"))}`,
          `"Year Level",${csvEscape(String(filters.yearGroup || "All Levels"))}`,
          `"Total Students","${data.students.total}"`,
          `"Overall Attendance Rate","${data.summary.overallAttendanceRate}%"`,
          `"Below Threshold",${csvEscape(data.summary.threshold > 0 ? `${data.summary.studentsBelowThreshold} (Below ${data.summary.threshold}%)` : "None / Off")}`,
          `""`,
          `"Student Name","Email","Academic Year","Year Level","Term","Guardian Name","Guardian Phone","Guardian Email","Subjects Breakdown","Total Sessions","Present","Late","Absent","Excused","Attendance Rate (%)","Below Threshold"`,
          ...data.students.items.map((s) => {
            const subsStr = (s.subjectBreakdown || [])
              .map((sb) => `${sb.subject}: ${sb.attendanceRate}% (${sb.teacherName || "No teacher"})`)
              .join("; ");
            return `${csvEscape(s.studentName)},${csvEscape(s.email || "N/A")},${csvEscape(s.academicYear || "N/A")},${csvEscape(s.yearLevel || "N/A")},${csvEscape(s.termName || "N/A")},${csvEscape(s.guardianName || "N/A")},${csvEscape(s.guardianPhone || "N/A")},${csvEscape(s.guardianEmail || "N/A")},${csvEscape(subsStr || "General")},${csvEscape(s.totalSessions)},${csvEscape(s.present)},${csvEscape(s.late)},${csvEscape(s.absent)},${csvEscape(s.excused)},${csvEscape(`${s.attendanceRate}%`)},${csvEscape(s.isBelowThreshold ? "YES" : "NO")}`;
          }),
        ].join("\n");
      }
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

  async notifyGuardianAttendance(
    input: NotifyGuardianInput,
    user: { id: string; fullName: string },
  ) {
    const student = await AppDataSource.getRepository(User).findOne({
      where: { id: input.studentId },
    });

    if (!student) {
      throw new Error("Student record not found.");
    }

    const deliveredChannels: ("email" | "sms")[] = [];
    const errors: string[] = [];

    if (input.channels.includes("email")) {
      const targetEmail = input.guardianEmail?.trim();
      if (!targetEmail) {
        errors.push("No guardian email address provided.");
      } else {
        try {
          const config = await emailService.getConfig();
          if (config?.enabled && config.resendApiKey) {
            const { Resend } = await import("resend");
            const resend = new Resend(config.resendApiKey);
            await resend.emails.send({
              from: `${config.fromName} <${config.fromEmail}>`,
              to: targetEmail,
              subject: input.subject || `Attendance Notice: ${student.fullName} – Enhance Education`,
              text: input.message,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff;">
                  <h2 style="color: #002a1c; margin-top: 0; font-size: 20px;">Enhance Education</h2>
                  <h3 style="color: #1F5C50; margin-top: 4px; font-size: 15px;">${input.subject || "Official Attendance Notice"}</h3>
                  <div style="white-space: pre-wrap; font-size: 13.5px; line-height: 1.65; color: #334155; margin: 20px 0; background: #f8fafc; padding: 16px; border-radius: 8px; border-left: 4px solid #1F5C50;">${input.message}</div>
                  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
                  <p style="font-size: 11px; color: #64748b; margin-bottom: 0;">This is an automated official communication from Enhance Education Management System.</p>
                </div>
              `,
            });
          }
          deliveredChannels.push("email");
        } catch (err) {
          errors.push(`Email delivery error: ${err instanceof Error ? err.message : "Unknown error"}`);
        }
      }
    }

    if (input.channels.includes("sms")) {
      const targetPhone = input.guardianPhone?.trim();
      if (!targetPhone) {
        errors.push("No guardian phone number provided.");
      } else {
        try {
          const config = await emailService.getConfig();
          if (config?.smsEnabled && config.twilioAccountSid && config.twilioAuthToken && config.twilioFromNumber) {
            const twilioModule = await import("twilio");
            const twilioClient = twilioModule.default(config.twilioAccountSid, config.twilioAuthToken);
            await twilioClient.messages.create({
              body: input.message,
              from: config.twilioFromNumber,
              to: targetPhone,
            });
          }
          deliveredChannels.push("sms");
        } catch (err) {
          errors.push(`SMS delivery error: ${err instanceof Error ? err.message : "Unknown error"}`);
        }
      }
    }

    await writeAuditLog({
      actorUserId: user.id,
      actorName: user.fullName,
      action: "CREATED",
      recordType: "attendance_guardian_alert",
      recordId: student.id,
      recordLabel: `Sent attendance alert to guardian for ${student.fullName}`,
      after: {
        studentId: student.id,
        studentName: student.fullName,
        channels: input.channels,
        deliveredChannels,
        guardianEmail: input.guardianEmail,
        guardianPhone: input.guardianPhone,
        subject: input.subject,
        errors,
        sentAt: new Date().toISOString(),
      },
    });

    return {
      success: deliveredChannels.length > 0,
      deliveredChannels,
      errors: errors.length > 0 ? errors : undefined,
      message: `Attendance notice sent successfully via ${deliveredChannels.join(" & ").toUpperCase() || "channels"}.`,
    };
  }
}

export const adminReportsService = new AdminReportsService();
