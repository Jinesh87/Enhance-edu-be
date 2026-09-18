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
  Enrollment,
} from "../../../entities/index.js";
import { writeAuditLog } from "../../../common/utils/audit-log.js";
import { emailService } from "../../email/email.service.js";
import type { ReportQueryInput, NotifyGuardianInput } from "./admin-reports.validation.js";

function csvEscape(val: unknown): string {
  if (val === null || val === undefined) return '""';
  const str = String(val);
  return `"${str.replace(/"/g, '""')}"`;
}

function formatCsvDate(val: unknown): string {
  if (!val) return "—";
  const d = new Date(String(val));
  if (isNaN(d.getTime())) return String(val);
  return d.toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatCsvDateTime(val: unknown): string {
  if (!val) return "—";
  const d = new Date(String(val));
  if (isNaN(d.getTime())) return String(val);
  return d.toLocaleString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function formatCsvTime(val: unknown): string {
  if (!val) return "—";
  const d = new Date(String(val));
  if (isNaN(d.getTime())) return String(val);
  return d.toLocaleTimeString("en-AU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
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
        subjectBreakdown,
      };
    });

    studentRows.sort((a, b) => a.attendanceRate - b.attendanceRate);

    const totalStudentsBelow = studentRows.filter(
      (s) => s.isBelowThreshold,
    ).length;
    const totalStudents = studentRows.length;

    let filteredStudentRows = studentRows;

    const statusUpper = (filters.statusFilter || "").toUpperCase().trim();
    if (statusUpper === "AT_RISK") {
      filteredStudentRows = filteredStudentRows.filter((s) => s.isBelowThreshold);
    } else if (statusUpper === "GOOD_STANDING") {
      filteredStudentRows = filteredStudentRows.filter((s) => !s.isBelowThreshold);
    }

    if (filters.search && filters.search.trim()) {
      const q = filters.search.trim().toLowerCase();
      filteredStudentRows = filteredStudentRows.filter(
        (s) =>
          s.studentName.toLowerCase().includes(q) ||
          (s.email && s.email.toLowerCase().includes(q)),
      );
    }

    const paginatedStudents = filteredStudentRows.slice(
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
        totalRecords: totalCalculated,
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
        total: filteredStudentRows.length,
        page,
        limit,
        totalPages: Math.ceil(filteredStudentRows.length / limit) || 1,
      },
      filtersApplied: filters,
      lastUpdated: new Date().toISOString(),
    };
  }

  async getStudentAttendanceDetails(studentId: string, filters: ReportQueryInput) {
    const threshold = filters.threshold ?? 80;

    const holidayQuery = AppDataSource.getRepository(Holiday).createQueryBuilder("h");
    if (filters.dateFrom && filters.dateTo) {
      holidayQuery.where("h.startDate <= :dateTo AND h.endDate >= :dateFrom", {
        dateFrom: filters.dateTo,
        dateTo: filters.dateFrom,
      });
    }
    const holidays = await holidayQuery.getMany();
    const holidayDateRanges = holidays.map((h) => ({
      start: h.startDate,
      end: h.endDate,
    }));

    let studentEntity: Student | null = null;
    let userEntity: User | null = null;

    try {
      studentEntity = await AppDataSource.getRepository(Student).findOne({
        where: [{ userId: studentId }, { id: studentId }],
        relations: {
          user: true,
          guardianLinks: { guardian: true },
        },
      });
      if (studentEntity?.user) {
        userEntity = studentEntity.user;
      }
    } catch {
      // fallback
    }

    if (!userEntity) {
      userEntity = await AppDataSource.getRepository(User).findOne({
        where: { id: studentId },
      });
    }

    const firstGuardian = studentEntity?.guardianLinks?.[0]?.guardian;
    const studentName = userEntity?.fullName || studentEntity?.fullName || "Student";
    const studentEmail = userEntity?.email || null;
    const guardianName = firstGuardian?.fullName || null;
    const guardianEmail = firstGuardian?.email || null;
    const guardianPhone = firstGuardian?.mobile || null;

    const query = AppDataSource.getRepository(AttendanceRecord)
      .createQueryBuilder("ar")
      .innerJoinAndSelect("ar.session", "s")
      .leftJoinAndSelect("s.class", "c")
      .leftJoinAndSelect("c.term", "cterm")
      .leftJoinAndSelect("cterm.academicYear", "cay")
      .leftJoinAndSelect("cterm.yearLevel", "cyl")
      .leftJoinAndSelect("s.classroom", "cr")
      .leftJoinAndSelect("s.teacher", "st")
      .leftJoinAndSelect("c.teacher", "ct")
      .leftJoinAndSelect("s.assessment", "a")
      .where("ar.studentId = :studentId", { studentId });

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
      query.andWhere("c.subject = :subjectName", { subjectName: subName });
    }
    if (filters.termId) {
      query.andWhere("c.termId = :termId", { termId: filters.termId });
    }
    if (filters.teacherId) {
      query.andWhere(
        "(s.teacherId = :teacherId OR (s.teacherId IS NULL AND c.teacher = :teacherId))",
        { teacherId: filters.teacherId }
      );
    }

    const records = await query.orderBy("s.startAt", "ASC").getMany();

    const validRecords = records.filter((r) => {
      if (!r.session?.startAt) return true;
      const sessionDateStr = r.session.startAt.toISOString().slice(0, 10);
      const isHoliday = holidayDateRanges.some(
        (h) => sessionDateStr >= h.start && sessionDateStr <= h.end
      );
      return !isHoliday;
    });

    let present = 0;
    let late = 0;
    let absent = 0;
    let excused = 0;
    let exceptions = 0;

    let academicYear: string | number | null = null;
    let yearLevel: string | null = studentEntity?.yearLevel ? `Year ${studentEntity.yearLevel}` : null;
    let termName: string | null = null;

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

    const sessionLogs: StudentSessionLog[] = [];
    const subjectStatsMap = new Map<
      string,
      {
        total: number;
        present: number;
        late: number;
        absent: number;
        excused: number;
        teacherName: string;
      }
    >();

    for (const r of validRecords) {
      const status = r.status;
      if (status === AttendanceStatus.PRESENT) present++;
      else if (status === AttendanceStatus.LATE) late++;
      else if (status === AttendanceStatus.ABSENT) absent++;
      else if (status === AttendanceStatus.EXCUSED) excused++;
      else if (status === AttendanceStatus.EXCEPTION) exceptions++;

      if (r.session.class?.term) {
        const term = r.session.class.term;
        if (!academicYear && term.academicYear) {
          academicYear = term.academicYear.year || term.academicYear.displayName;
        }
        if (!yearLevel && term.yearLevel) {
          yearLevel = term.yearLevel.name;
        }
        if (!termName && term.name) {
          termName = term.name;
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

      sessionLogs.push({
        sessionId: r.session.id,
        date: sessionDate,
        time: sessionTime,
        subject: subjectName,
        teacher: teacherName,
        room: roomName,
        status: r.status,
        scannedAt: r.scannedAt ? r.scannedAt.toISOString() : null,
      });

      if (!subjectStatsMap.has(subjectName)) {
        subjectStatsMap.set(subjectName, {
          total: 0,
          present: 0,
          late: 0,
          absent: 0,
          excused: 0,
          teacherName,
        });
      }
      const stSub = subjectStatsMap.get(subjectName)!;
      stSub.total++;
      if (teacherName !== "Unassigned") {
        stSub.teacherName = teacherName;
      }
      if (status === AttendanceStatus.PRESENT) stSub.present++;
      else if (status === AttendanceStatus.LATE) stSub.late++;
      else if (status === AttendanceStatus.ABSENT) stSub.absent++;
      else if (status === AttendanceStatus.EXCUSED) stSub.excused++;
    }

    sessionLogs.sort((a, b) => a.date.localeCompare(b.date));

    const totalActive = present + late + absent + excused;
    const rate = totalActive > 0 ? ((present + late) / totalActive) * 100 : 100;

    const subjectBreakdown = Array.from(subjectStatsMap.entries()).map(([sub, stat]) => {
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

    return {
      studentId,
      studentName,
      email: studentEmail,
      academicYear,
      yearLevel,
      termName,
      guardianName,
      guardianEmail,
      guardianPhone,
      totalSessions: validRecords.length,
      present,
      late,
      absent,
      excused,
      exceptions,
      attendanceRate: Math.round(rate * 10) / 10,
      isBelowThreshold: threshold > 0 ? rate < threshold : false,
      subjectBreakdown,
      sessionLogs,
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

    const totalPipelineConverted = allEnquiries.filter(
      (e) => e.convertedEnrollmentId,
    ).length;

    // Direct enrollments count & details in period (created directly without prior enquiry)
    const directEnrollmentQuery = AppDataSource.getRepository(Enrollment)
      .createQueryBuilder("enr")
      .leftJoinAndSelect("enr.student", "s")
      .leftJoinAndSelect("s.user", "su")
      .leftJoinAndSelect("enr.guardian", "g")
      .leftJoinAndSelect("s.guardianLinks", "gl")
      .leftJoinAndSelect("gl.guardian", "glg");

    if (filters.dateFrom) {
      directEnrollmentQuery.andWhere("enr.createdAt >= :dateFrom", {
        dateFrom: `${filters.dateFrom}T00:00:00Z`,
      });
    }
    if (filters.dateTo) {
      directEnrollmentQuery.andWhere("enr.createdAt <= :dateTo", {
        dateTo: `${filters.dateTo}T23:59:59Z`,
      });
    }

    const allEnrollmentsInPeriod = await directEnrollmentQuery.getMany();
    const convertedEnrollmentIds = new Set(
      allEnquiries
        .map((e) => e.convertedEnrollmentId)
        .filter((id): id is string => Boolean(id)),
    );

    const directEnrollments = allEnrollmentsInPeriod.filter(
      (enr) => !convertedEnrollmentIds.has(enr.id),
    );
    const directEnrollmentsCount = directEnrollments.length;

    const totalNewAdmissions = totalPipelineConverted + directEnrollmentsCount;

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

    if (directEnrollmentsCount > 0) {
      sourceAttribution.unshift({
        sourceId: "direct-walkin",
        sourceName: "Direct Admission (Walk-in / Direct Add)",
        totalEnquiries: directEnrollmentsCount,
        trialsBooked: 0,
        enrolled: directEnrollmentsCount,
        conversionRate: 100,
      });
    }

    const directEnrollmentItems = directEnrollments.map((enr) => {
      const studentName =
        enr.student?.fullName ||
        enr.student?.user?.fullName ||
        "Direct Enrolled Student";
      const guardianName =
        enr.guardian?.fullName ||
        enr.student?.guardianLinks?.[0]?.guardian?.fullName ||
        "Guardian (Direct Add)";
      const guardianEmail =
        enr.guardian?.email ||
        enr.student?.guardianLinks?.[0]?.guardian?.email ||
        null;
      const guardianMobile =
        enr.guardian?.mobile ||
        enr.student?.guardianLinks?.[0]?.guardian?.mobile ||
        null;

      return {
        id: enr.id,
        studentFullName: studentName,
        guardianFullName: guardianName,
        guardianEmail,
        guardianMobile,
        currentStage: "Converted (Direct Enrolment)",
        firstSource: "Direct Admission (Walk-in / Direct Add)",
        lastSource: "Direct Admission (Walk-in / Direct Add)",
        createdAt: enr.createdAt,
      };
    });

    const enquiryActivityItems = allEnquiries.map((e) => ({
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

    const combinedActivity = [
      ...enquiryActivityItems,
      ...directEnrollmentItems,
    ].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    let filteredActivity = combinedActivity;

    const statusUpper = (filters.statusFilter || "").toUpperCase().trim();
    if (statusUpper === "CONVERTED") {
      filteredActivity = filteredActivity.filter(
        (e) =>
          e.currentStage.toLowerCase().includes("converted") ||
          e.currentStage.toLowerCase().includes("enrolled"),
      );
    } else if (statusUpper === "LOST") {
      filteredActivity = filteredActivity.filter((e) =>
        e.currentStage.toLowerCase().includes("lost"),
      );
    } else if (statusUpper === "PIPELINE") {
      filteredActivity = filteredActivity.filter(
        (e) =>
          !e.currentStage.toLowerCase().includes("converted") &&
          !e.currentStage.toLowerCase().includes("enrolled") &&
          !e.currentStage.toLowerCase().includes("lost"),
      );
    }

    if (filters.search && filters.search.trim()) {
      const q = filters.search.trim().toLowerCase();
      filteredActivity = filteredActivity.filter(
        (e) =>
          (e.studentFullName && e.studentFullName.toLowerCase().includes(q)) ||
          (e.guardianFullName && e.guardianFullName.toLowerCase().includes(q)) ||
          (e.guardianEmail && e.guardianEmail.toLowerCase().includes(q)) ||
          (e.guardianMobile && e.guardianMobile.toLowerCase().includes(q)) ||
          (e.firstSource && e.firstSource.toLowerCase().includes(q)) ||
          (e.currentStage && e.currentStage.toLowerCase().includes(q)),
      );
    }

    const paginatedEnquiries = filteredActivity.slice(
      (page - 1) * limit,
      page * limit,
    );

    return {
      summary: {
        totalEnquiriesInPeriod: allEnquiries.length,
        touchPoint,
        totalConverted: totalPipelineConverted,
        directEnrollments: directEnrollmentsCount,
        totalAdmissions: totalNewAdmissions,
        overallConversionRate:
          allEnquiries.length > 0
            ? Math.round(
                (totalPipelineConverted / allEnquiries.length) * 1000,
              ) / 10
            : 0,
      },
      funnelStages,
      lostReasonBreakdown,
      sourceAttribution,
      enquiries: {
        items: paginatedEnquiries,
        total: filteredActivity.length,
        page,
        limit,
        totalPages: Math.ceil(filteredActivity.length / limit) || 1,
      },
      lastUpdated: new Date().toISOString(),
    };
  }

  async getEnquiryJourney(enquiryId: string) {
    const enquiry = await AppDataSource.getRepository(Enquiry).findOne({
      where: { id: enquiryId },
      relations: {
        currentStage: true,
        firstSource: true,
        lastSource: true,
        stageHistory: {
          toStage: true,
          fromStage: true,
          lostReason: true,
          actor: true,
        },
      },
    });

    if (enquiry) {
      const sortedHistories = (enquiry.stageHistory || []).sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );

      const timeline = sortedHistories.map((h) => ({
        id: h.id,
        fromStage: h.fromStage?.name ?? null,
        toStage: h.toStage?.name ?? "Unknown Stage",
        date: h.createdAt.toISOString(),
        changedByName: h.actor?.fullName ?? null,
        lostReasonName: h.lostReason?.name ?? null,
        notes: h.note ?? null,
      }));

      // If no histories exist, create initial creation event
      if (timeline.length === 0) {
        timeline.push({
          id: `init-${enquiry.id}`,
          fromStage: null,
          toStage: enquiry.currentStage?.name ?? "New enquiry",
          date: enquiry.createdAt.toISOString(),
          changedByName: "System",
          lostReasonName: null,
          notes: "Initial enquiry submission recorded.",
        });
      }

      return {
        id: enquiry.id,
        studentFullName: enquiry.studentFullName,
        guardianFullName: enquiry.guardianFullName,
        guardianEmail: enquiry.guardianEmail,
        guardianMobile: enquiry.guardianMobile,
        currentStage: enquiry.currentStage?.name ?? "Unknown",
        firstSource: enquiry.firstSource?.name ?? "Direct / Organic",
        lastSource: enquiry.lastSource?.name ?? enquiry.firstSource?.name ?? "Direct / Organic",
        createdAt: enquiry.createdAt.toISOString(),
        assignedTo: null,
        notes: null,
        trialDate: enquiry.trialEndDate || null,
        trialConfirmed: Boolean(enquiry.trialConfirmed),
        trialAttended: Boolean(enquiry.trialAttended),
        isDirectEnrollment: false,
        timeline,
      };
    }

    // Check direct enrollment
    const enrollment = await AppDataSource.getRepository(Enrollment).findOne({
      where: { id: enquiryId },
      relations: {
        student: { user: true, guardianLinks: { guardian: true } },
        guardian: true,
      },
    });

    if (enrollment) {
      const studentName =
        enrollment.student?.fullName ||
        enrollment.student?.user?.fullName ||
        "Direct Enrolled Student";
      const guardianName =
        enrollment.guardian?.fullName ||
        enrollment.student?.guardianLinks?.[0]?.guardian?.fullName ||
        "Guardian";
      const guardianEmail =
        enrollment.guardian?.email ||
        enrollment.student?.guardianLinks?.[0]?.guardian?.email ||
        null;
      const guardianMobile =
        enrollment.guardian?.mobile ||
        enrollment.student?.guardianLinks?.[0]?.guardian?.mobile ||
        null;

      return {
        id: enrollment.id,
        studentFullName: studentName,
        guardianFullName: guardianName,
        guardianEmail,
        guardianMobile,
        currentStage: "Converted (Direct Enrolment)",
        firstSource: "Direct Admission (Walk-in / Direct Add)",
        lastSource: "Direct Admission (Walk-in / Direct Add)",
        createdAt: enrollment.createdAt.toISOString(),
        assignedTo: "Admin",
        notes: "Enrolled directly into institution without prior sales pipeline enquiry.",
        trialDate: null,
        trialConfirmed: false,
        trialAttended: false,
        isDirectEnrollment: true,
        timeline: [
          {
            id: `enr-${enrollment.id}`,
            fromStage: null,
            toStage: "Converted (Direct Enrolment)",
            date: enrollment.createdAt.toISOString(),
            changedByName: "Registrar / Administrator",
            lostReasonName: null,
            notes: "Direct student admission completed.",
          },
        ],
      };
    }

    throw new Error("Enquiry record not found.");
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

    let filteredSessionItems = sessionItems;

    const statusUpper = (filters.statusFilter || "").toUpperCase().trim();
    if (statusUpper === "COMPLETED") {
      filteredSessionItems = filteredSessionItems.filter((s) => s.isCompleted && !s.isHoliday);
    } else if (statusUpper === "UPCOMING") {
      filteredSessionItems = filteredSessionItems.filter((s) => !s.isCompleted && !s.isHoliday);
    } else if (statusUpper === "TEACHER_GAPS") {
      filteredSessionItems = filteredSessionItems.filter((s) => s.isTeacherGap);
    } else if (statusUpper === "ROOM_GAPS") {
      filteredSessionItems = filteredSessionItems.filter((s) => s.isRoomGap);
    } else if (statusUpper === "SUBSTITUTES") {
      filteredSessionItems = filteredSessionItems.filter((s) => s.isTeacherOverride);
    } else if (statusUpper === "HOLIDAY" || statusUpper === "HOLIDAYS") {
      filteredSessionItems = filteredSessionItems.filter((s) => s.isHoliday);
    }

    if (filters.search && filters.search.trim()) {
      const q = filters.search.trim().toLowerCase();
      filteredSessionItems = filteredSessionItems.filter(
        (s) =>
          s.className.toLowerCase().includes(q) ||
          (s.classCode && s.classCode.toLowerCase().includes(q)) ||
          (s.teacherName && s.teacherName.toLowerCase().includes(q)) ||
          (s.room && s.room.toLowerCase().includes(q)),
      );
    }

    const paginatedSessions = filteredSessionItems.slice(
      (page - 1) * limit,
      page * limit,
    );

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
        items: paginatedSessions,
        total: filteredSessionItems.length,
        page,
        limit,
        totalPages: Math.ceil(filteredSessionItems.length / limit) || 1,
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

    if (filters.search) {
      query.andWhere(
        "(LOWER(a.name) LIKE :search OR LOWER(a.subject) LIKE :search OR LOWER(u.fullName) LIKE :search OR LOWER(a.yearGroup) LIKE :search)",
        { search: `%${filters.search.toLowerCase()}%` }
      );
    }
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
    let totalPendingGrading = 0;
    let totalGraded = 0;
    let totalScheduled = 0;
    let sumScoredPercentages = 0;
    let totalScoredSubmissions = 0;

    const items = assessments.map((a) => {
      if (a.kind === "ENTRANCE") totalEntrance++;
      else totalSchool++;

      const candCount = a.students?.length ?? 0;
      totalCandidates += candCount;

      const aSubs = subMap.get(a.id) ?? [];
      totalSubmissionsCount += aSubs.length;

      const scoredSubs = aSubs.filter((s) => s.mark != null);
      const pendingGradingCount = aSubs.length - scoredSubs.length;
      totalPendingGrading += pendingGradingCount;

      const isGraded =
        a.status.toLowerCase().includes("graded") ||
        a.status.toLowerCase().includes("published") ||
        a.status.toLowerCase().includes("completed") ||
        (aSubs.length > 0 && pendingGradingCount === 0);
      const isScheduled =
        a.status.toLowerCase().includes("scheduled") ||
        a.status.toLowerCase().includes("draft") ||
        a.status.toLowerCase().includes("active");

      if (isGraded) totalGraded++;
      if (isScheduled) totalScheduled++;

      const totalMarksVal = a.totalMarks ? Number(a.totalMarks) : 100;

      let highestMark: number | null = null;
      let lowestMark: number | null = null;
      if (scoredSubs.length > 0) {
        const marks = scoredSubs.map((s) => Number(s.mark));
        highestMark = Math.max(...marks);
        lowestMark = Math.min(...marks);
        for (const s of scoredSubs) {
          sumScoredPercentages += (Number(s.mark) / totalMarksVal) * 100;
          totalScoredSubmissions++;
        }
      }

      const avgMark =
        scoredSubs.length > 0
          ? scoredSubs.reduce((acc, s) => acc + Number(s.mark), 0) /
            scoredSubs.length
          : null;

      const submissionRate = candCount > 0 ? Math.round((aSubs.length / candCount) * 100) : 0;

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
        pendingGradingCount,
        submissionRate,
        highestMark,
        lowestMark,
        averageMark: avgMark ? Math.round(avgMark * 10) / 10 : null,
        totalMarks: a.totalMarks ? Number(a.totalMarks) : null,
      };
    });

    const overallAverageScore =
      totalScoredSubmissions > 0
        ? Math.round((sumScoredPercentages / totalScoredSubmissions) * 10) / 10
        : 0;
    const overallSubmissionRate =
      totalCandidates > 0
        ? Math.round((totalSubmissionsCount / totalCandidates) * 100)
        : 0;

    let filteredItems = items;

    const statusLower = (filters.statusFilter || "").toLowerCase().trim();
    if (statusLower === "school") {
      filteredItems = filteredItems.filter((item) => item.kind === "SCHOOL");
    } else if (statusLower === "entrance") {
      filteredItems = filteredItems.filter((item) => item.kind === "ENTRANCE");
    } else if (statusLower === "graded") {
      filteredItems = filteredItems.filter(
        (item) =>
          item.status.toLowerCase().includes("graded") ||
          item.status.toLowerCase().includes("published") ||
          item.status.toLowerCase().includes("completed") ||
          (item.submissionsCount > 0 && (!item.pendingGradingCount || item.pendingGradingCount === 0)),
      );
    } else if (statusLower === "pending_grading") {
      filteredItems = filteredItems.filter(
        (item) =>
          (item.pendingGradingCount && item.pendingGradingCount > 0) ||
          item.status.toLowerCase().includes("pending") ||
          (item.submissionsCount > 0 && item.averageMark === null),
      );
    } else if (statusLower === "scheduled") {
      filteredItems = filteredItems.filter(
        (item) =>
          item.status.toLowerCase().includes("scheduled") ||
          item.status.toLowerCase().includes("draft") ||
          item.status.toLowerCase().includes("active"),
      );
    }

    const paginatedItems = filteredItems.slice((page - 1) * limit, page * limit);

    return {
      summary: {
        totalAssessments: assessments.length,
        totalSchool,
        totalEntrance,
        totalGraded,
        totalScheduled,
        totalCandidates,
        totalSubmissions: totalSubmissionsCount,
        totalPendingGrading,
        overallAverageScore,
        submissionRate: overallSubmissionRate,
      },
      assessments: {
        items: paginatedItems,
        total: filteredItems.length,
        page,
        limit,
        totalPages: Math.ceil(filteredItems.length / limit) || 1,
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

    if (filters.search) {
      query.andWhere(
        "(LOWER(hw.title) LIKE :search OR LOWER(sub.name) LIKE :search OR LOWER(u.fullName) LIKE :search OR LOWER(hw.yearGroup) LIKE :search)",
        { search: `%${filters.search.toLowerCase()}%` }
      );
    }
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
    let totalPendingMarkingTasks = 0;
    let totalFullyMarkedTasks = 0;
    let totalActiveTasks = 0;
    let overdueTasksCount = 0;

    const todayStr = new Date().toISOString().slice(0, 10);

    const subjectBreakdownMap = new Map<
      string,
      {
        subject: string;
        tasks: number;
        submissions: number;
        assignedStudents: number;
      }
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
      if (pendingMark > 0) totalPendingMarkingTasks++;

      const submissionRate =
        studentCount > 0 ? Math.round((subs.length / studentCount) * 100) : 0;
      const isOverdue = hw.dueDate < todayStr && submissionRate < 100;
      const fullyMarked = subs.length > 0 && pendingMark === 0;

      if (fullyMarked) totalFullyMarkedTasks++;
      if (isOverdue) overdueTasksCount++;
      if (!isOverdue && !fullyMarked) totalActiveTasks++;

      const subName = hw.subject?.name || "General";
      if (!subjectBreakdownMap.has(subName)) {
        subjectBreakdownMap.set(subName, {
          subject: subName,
          tasks: 0,
          submissions: 0,
          assignedStudents: 0,
        });
      }
      const sm = subjectBreakdownMap.get(subName)!;
      sm.tasks++;
      sm.submissions += subs.length;
      sm.assignedStudents += studentCount;

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
        submissionRate,
        isOverdue,
        fullyMarked,
      };
    });

    const subjectBreakdown = Array.from(subjectBreakdownMap.values()).map(
      (sb) => ({
        subject: sb.subject,
        tasks: sb.tasks,
        submissions: sb.submissions,
        submissionRate:
          sb.assignedStudents > 0
            ? Math.round((sb.submissions / sb.assignedStudents) * 100)
            : 0,
      }),
    );

    let filteredItems = items;

    const statusLower = (filters.statusFilter || "").toLowerCase().trim();
    if (statusLower === "pending_marking") {
      filteredItems = filteredItems.filter((item) => item.pendingMarkingCount > 0);
    } else if (statusLower === "completed") {
      filteredItems = filteredItems.filter(
        (item) => item.fullyMarked || (item.submissionRate >= 100 && item.submissionsCount > 0),
      );
    } else if (statusLower === "active") {
      filteredItems = filteredItems.filter((item) => item.dueDate >= todayStr);
    } else if (statusLower === "overdue") {
      filteredItems = filteredItems.filter((item) => item.isOverdue);
    }

    const paginatedItems = filteredItems.slice((page - 1) * limit, page * limit);

    return {
      summary: {
        totalAssignedTasks,
        totalAssignedStudents,
        totalSubmissions,
        totalPendingMarking,
        totalPendingMarkingTasks,
        totalFullyMarkedTasks,
        totalActiveTasks,
        overdueTasksCount,
        submissionRate:
          totalAssignedStudents > 0
            ? Math.round((totalSubmissions / totalAssignedStudents) * 1000) / 10
            : 0,
      },
      subjectBreakdown,
      homework: {
        items: paginatedItems,
        total: filteredItems.length,
        page,
        limit,
        totalPages: Math.ceil(filteredItems.length / limit) || 1,
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

    const periodStr =
      filters.dateFrom && filters.dateTo
        ? `${formatCsvDate(filters.dateFrom)} to ${formatCsvDate(filters.dateTo)}`
        : filters.dateFrom
          ? `From ${formatCsvDate(filters.dateFrom)}`
          : filters.dateTo
            ? `Up to ${formatCsvDate(filters.dateTo)}`
            : "All Time (Cumulative History)";

    if (tab === "attendance") {
      if (filters.studentId) {
        const student = await this.getStudentAttendanceDetails(filters.studentId, filters);
        recordCount = student.sessionLogs?.length || 0;
        csvContent = [
          `"Enhance Education — Student Attendance Transcript",""`,
          `"Student Name",${csvEscape(student.studentName)}`,
          `"Student Email",${csvEscape(student.email || "—")}`,
          `"Academic Cohort",${csvEscape(`${student.academicYear || "All Years"} • ${student.yearLevel || "All Levels"} (${student.termName || "All Terms"})`)}`,
          `"Guardian Contact",${csvEscape(`${student.guardianName || "—"} ${student.guardianPhone ? `(${student.guardianPhone})` : ""}`)}`,
          `"Reporting Period",${csvEscape(periodStr)}`,
          `"Generated At",${csvEscape(formatCsvDateTime(new Date()))}`,
          `"Generated By",${csvEscape(user.fullName)}`,
          `"Total Sessions","${student.totalSessions}"`,
          `"Attendance Rate","${student.attendanceRate}%"`,
          `"Threshold Standing",${csvEscape(student.isBelowThreshold ? "BELOW TARGET THRESHOLD" : "COMPLIANT / GOOD STANDING")}`,
          `""`,
          `"Date","Time Slot","Subject","Teacher","Room / Venue","Attendance Status","Check-in Timestamp"`,
          ...(student.sessionLogs || []).map(
            (log) =>
              `${csvEscape(formatCsvDate(log.date))},${csvEscape(log.time || "—")},${csvEscape(log.subject)},${csvEscape(log.teacher)},${csvEscape(log.room)},${csvEscape(log.status)},${csvEscape(log.scannedAt ? formatCsvDateTime(log.scannedAt) : "—")}`,
          ),
        ].join("\n");
      } else {
        const data = await this.getAttendanceReport({ ...filters, limit: 10000 });
        recordCount = data.students.total;
        csvContent = [
          `"Enhance Education — Attendance & Roll Analysis Report",""`,
          `"Reporting Period",${csvEscape(periodStr)}`,
          `"Academic Cohort",${csvEscape(`${filters.academicYear || "All Years"} • ${filters.yearGroup || "All Levels"}`)}`,
          `"Generated At",${csvEscape(formatCsvDateTime(new Date()))}`,
          `"Generated By",${csvEscape(user.fullName)}`,
          `"Total Students Enrolled","${data.students.total}"`,
          `"Overall Attendance Rate","${data.summary.overallAttendanceRate}%"`,
          `"Benchmark Target",${csvEscape(data.summary.threshold > 0 ? `${data.summary.threshold}% Target` : "None Set")}`,
          `"Benchmark Compliance Standing",${csvEscape(data.summary.threshold > 0 ? `${data.summary.studentsBelowThreshold} Students Below Target` : "Compliant")}`,
          `""`,
          `"Student Full Name","Email","Academic Year","Year Level","Term","Guardian Contact","Subject Breakdown (Rate %)","Total Sessions","Present (On-Time)","Late Arrivals","Unexcused Absences","Excused Absences","Attendance Rate (%)","Compliance Standing"`,
          ...data.students.items.map((s) => {
            const guardianContact = s.guardianName
              ? `${s.guardianName} ${s.guardianPhone ? `(${s.guardianPhone})` : s.guardianEmail ? `(${s.guardianEmail})` : ""}`
              : "—";
            const subsStr = (s.subjectBreakdown || [])
              .map((sb) => `${sb.subject}: ${sb.attendanceRate}% (${sb.teacherName || "No teacher"})`)
              .join("; ");
            const complianceStr =
              data.summary.threshold > 0
                ? s.isBelowThreshold
                  ? "BELOW TARGET"
                  : "COMPLIANT"
                : "ENROLLED";
            return `${csvEscape(s.studentName)},${csvEscape(s.email || "—")},${csvEscape(s.academicYear || "—")},${csvEscape(s.yearLevel || "—")},${csvEscape(s.termName || "—")},${csvEscape(guardianContact)},${csvEscape(subsStr || "General Cohort")},${csvEscape(s.totalSessions)},${csvEscape(s.present)},${csvEscape(s.late)},${csvEscape(s.absent)},${csvEscape(s.excused)},${csvEscape(`${s.attendanceRate}%`)},${csvEscape(complianceStr)}`;
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
        `"Enhance Education — Enquiries & Conversion Funnel Report",""`,
        `"Reporting Period",${csvEscape(periodStr)}`,
        `"Attribution Model",${csvEscape(`${data.summary.touchPoint.toUpperCase()} TOUCH ATTRIBUTION`)}`,
        `"Generated At",${csvEscape(formatCsvDateTime(new Date()))}`,
        `"Generated By",${csvEscape(user.fullName)}`,
        `"Total Pipeline Enquiries","${data.summary.totalEnquiriesInPeriod}"`,
        `"Pipeline Conversions","${data.summary.totalConverted} (${data.summary.overallConversionRate}% Funnel Rate)"`,
        `"Direct Admissions (Walk-in)","${data.summary.directEnrollments || 0}"`,
        `"Total New Students Enrolled","${data.summary.totalAdmissions || data.summary.totalConverted + (data.summary.directEnrollments || 0)}"`,
        `""`,
        `"Student / Lead Name","Guardian Full Name","Guardian Email","Guardian Mobile","Initial Acquisition Source","Latest Source","Current Pipeline Stage","Date Registered"`,
        ...data.enquiries.items.map(
          (e) =>
            `${csvEscape(e.studentFullName || "Student / Lead")},${csvEscape(e.guardianFullName || "—")},${csvEscape(e.guardianEmail || "—")},${csvEscape(e.guardianMobile || "—")},${csvEscape(e.firstSource)},${csvEscape(e.lastSource)},${csvEscape(e.currentStage)},${csvEscape(formatCsvDate(e.createdAt))}`,
        ),
      ].join("\n");
    } else if (tab === "classes") {
      const data = await this.getClassesSessionsReport({
        ...filters,
        limit: 10000,
      });
      recordCount = data.sessions.total;
      const deliveryRate =
        data.summary.totalScheduled > 0
          ? Math.round(
              (data.summary.totalCompleted / data.summary.totalScheduled) * 100,
            )
          : 0;
      csvContent = [
        `"Enhance Education — Classes & Timetable Occurrences Report",""`,
        `"Reporting Period",${csvEscape(periodStr)}`,
        `"Academic Cohort",${csvEscape(`${filters.academicYear || "All Years"} • ${filters.yearGroup || "All Levels"}`)}`,
        `"Generated At",${csvEscape(formatCsvDateTime(new Date()))}`,
        `"Generated By",${csvEscape(user.fullName)}`,
        `"Total Scheduled Sessions","${data.summary.totalScheduled}"`,
        `"Completed Sessions","${data.summary.totalCompleted} (${deliveryRate}% Delivery Rate)"`,
        `"Teacher Allocation Gaps","${data.summary.missingTeacherGaps} Sessions Unassigned"`,
        `"Teacher Relief Substitutes Used","${data.summary.teacherOverrides} Sessions Covered by Sub"`,
        `"Room Allocation Gaps","${data.summary.missingRoomGaps} Sessions Missing Room"`,
        `"Holiday Affected Sessions","${data.summary.totalHolidayAffected} Sessions Cancelled / Holiday"`,
        `""`,
        `"Class Name","Class Code","Date","Scheduled Time Slot","Room / Venue","Assigned Teacher","Delivery Status","Coverage Note"`,
        ...data.sessions.items.map((s) => {
          const statusStr = s.isHoliday
            ? "Holiday / Cancelled"
            : s.isTeacherGap
              ? "Teacher Gap (Unassigned)"
              : s.isRoomGap
                ? "Room Gap (Unallocated)"
                : s.isCompleted
                  ? "Completed"
                  : "Scheduled";
          const timeSlot = `${formatCsvTime(s.startAt)} – ${formatCsvTime(s.endAt)}`;
          const coverageNote = s.isTeacherOverride
            ? "Relief Substitute Assigned"
            : s.isTeacherGap
              ? "No Teacher"
              : "Regular Staff";
          return `${csvEscape(s.className)},${csvEscape(s.classCode || "—")},${csvEscape(formatCsvDate(s.startAt))},${csvEscape(timeSlot)},${csvEscape(s.room || "No Room")},${csvEscape(s.teacherName || "Unassigned")},${csvEscape(statusStr)},${csvEscape(coverageNote)}`;
        }),
      ].join("\n");
    } else if (tab === "assessments") {
      const data = await this.getAssessmentsReport({
        ...filters,
        limit: 10000,
      });
      recordCount = data.assessments.total;
      const turnInRate =
        data.summary.totalCandidates > 0
          ? Math.round(
              (data.summary.totalSubmissions / data.summary.totalCandidates) *
                100,
            )
          : 0;
      csvContent = [
        `"Enhance Education — Assessments & Performance Outcomes Report",""`,
        `"Reporting Period",${csvEscape(periodStr)}`,
        `"Academic Cohort",${csvEscape(`${filters.academicYear || "All Years"} • ${filters.yearGroup || "All Levels"}`)}`,
        `"Generated At",${csvEscape(formatCsvDateTime(new Date()))}`,
        `"Generated By",${csvEscape(user.fullName)}`,
        `"Total Assessments Conducted","${data.summary.totalAssessments}"`,
        `"Curriculum vs Entrance Split",${csvEscape(`${data.summary.totalSchool} School Internal / ${data.summary.totalEntrance} Entrance Exam`)}`,
        `"Total Student Seatings","${data.summary.totalCandidates} Candidates"`,
        `"Total Submissions Received","${data.summary.totalSubmissions} Submissions (${turnInRate}% Turn-in Rate)"`,
        `""`,
        `"Assessment Title","Subject","Year Level / Cohort","Assessment Format","Schedule Mode","Date","Start Time","Teacher","Registered Candidates","Submissions Received","Turn-in Rate (%)","Average Score","Evaluation Status"`,
        ...data.assessments.items.map((a) => {
          const rate =
            a.candidatesCount > 0
              ? Math.round((a.submissionsCount / a.candidatesCount) * 100)
              : 0;
          const avgScore =
            a.averageMark != null
              ? `${a.averageMark}${a.totalMarks ? ` / ${a.totalMarks}` : "%"}`
              : "—";
          return `${csvEscape(a.name)},${csvEscape(a.subject)},${csvEscape(a.yearGroup || "All")},${csvEscape(a.kind)},${csvEscape(a.scheduleType || "Scheduled")},${csvEscape(formatCsvDate(a.assessmentDate))},${csvEscape(a.startTime || "—")},${csvEscape(a.teacherName || "—")},${csvEscape(a.candidatesCount)},${csvEscape(a.submissionsCount)},${csvEscape(`${rate}%`)},${csvEscape(avgScore)},${csvEscape(a.status)}`;
        }),
      ].join("\n");
    } else if (tab === "homework") {
      const data = await this.getHomeworkReport({ ...filters, limit: 10000 });
      recordCount = data.homework.total;
      csvContent = [
        `"Enhance Education — Homework & Assignment Completion Report",""`,
        `"Reporting Period",${csvEscape(periodStr)}`,
        `"Academic Cohort",${csvEscape(`${filters.academicYear || "All Years"} • ${filters.yearGroup || "All Levels"}`)}`,
        `"Generated At",${csvEscape(formatCsvDateTime(new Date()))}`,
        `"Generated By",${csvEscape(user.fullName)}`,
        `"Total Assigned Tasks","${data.summary.totalAssignedTasks}"`,
        `"Total Assigned Student Instances","${data.summary.totalAssignedStudents}"`,
        `"Total Submissions Turned In","${data.summary.totalSubmissions}"`,
        `"Overall Submission Rate","${data.summary.submissionRate}%"`,
        `"Pending Teacher Marking","${data.summary.totalPendingMarking} Submissions Awaiting Evaluation"`,
        `""`,
        `"Assignment Title","Subject","Year Level / Cohort","Due Date","Assigned Teacher","Assigned Students","Submissions Received","Completion Rate (%)","Pending Marking"`,
        ...data.homework.items.map((h) => {
          const rate =
            h.assignedStudentsCount > 0
              ? Math.round(
                  (h.submissionsCount / h.assignedStudentsCount) * 100,
                )
              : 0;
          return `${csvEscape(h.title)},${csvEscape(h.subject)},${csvEscape(h.yearGroup || "All")},${csvEscape(formatCsvDate(h.dueDate))},${csvEscape(h.teacherName || "—")},${csvEscape(h.assignedStudentsCount)},${csvEscape(h.submissionsCount)},${csvEscape(`${rate}%`)},${csvEscape(h.pendingMarkingCount)}`;
        }),
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

  async getAssessmentSubmissions(assessmentId: string) {
    const assessment = await AppDataSource.getRepository(Assessment).findOne({
      where: { id: assessmentId },
      relations: {
        teacher: true,
        students: { student: true },
      },
    });

    if (!assessment) {
      throw new Error("Assessment not found");
    }

    const submissions = await AppDataSource.getRepository(AssessmentSubmission).find({
      where: { assessmentId },
      relations: {
        student: true,
        markedBy: true,
        files: true,
      },
    });

    // Collect all candidate student IDs (from enrolled candidate roster + any existing submission)
    const candidateStudentsMap = new Map<string, User>();
    if (assessment.students) {
      for (const st of assessment.students) {
        if (st.student) candidateStudentsMap.set(st.student.id, st.student);
      }
    }
    for (const sub of submissions) {
      if (sub.student) candidateStudentsMap.set(sub.student.id, sub.student);
    }

    const candidateUserIds = Array.from(candidateStudentsMap.keys());
    const studentProfiles =
      candidateUserIds.length > 0
        ? await AppDataSource.getRepository(Student).find({
            where: { userId: In(candidateUserIds) },
            relations: { guardianLinks: { guardian: true } },
          })
        : [];

    const studentProfileMap = new Map<string, Student>();
    for (const sp of studentProfiles) {
      if (sp.userId) studentProfileMap.set(sp.userId, sp);
    }

    const submissionMap = new Map<string, AssessmentSubmission>();
    for (const sub of submissions) {
      submissionMap.set(sub.studentId, sub);
    }

    const totalMarks = assessment.totalMarks ? Number(assessment.totalMarks) : 100;
    let submittedCount = 0;
    let gradedCount = 0;
    let pendingCount = 0;
    let sumMarks = 0;
    const scoredMarks: number[] = [];

    const studentRoster = candidateUserIds.map((userId) => {
      const user = candidateStudentsMap.get(userId)!;
      const profile = studentProfileMap.get(userId);
      const sub = submissionMap.get(userId);

      const guardians = (profile?.guardianLinks || [])
        .map((gl) => gl.guardian)
        .filter(Boolean)
        .map((g) => ({
          name: g.fullName,
          email: g.email || "",
          mobile: g.mobile || "",
        }));

      const primaryGuardian = guardians[0] || null;

      const isSubmitted = Boolean(sub && sub.status !== "DRAFT");
      const isGraded = Boolean(sub && sub.mark != null);
      const markNum = sub && sub.mark != null ? Number(sub.mark) : null;
      const percentage =
        markNum !== null && totalMarks > 0
          ? Math.round((markNum / totalMarks) * 1000) / 10
          : null;

      if (isSubmitted) {
        submittedCount++;
      } else {
        pendingCount++;
      }

      if (isGraded && markNum !== null) {
        gradedCount++;
        sumMarks += markNum;
        scoredMarks.push(markNum);
      }

      return {
        studentId: user.id,
        studentName: user.fullName || "Student",
        studentEmail: user.email || null,
        studentMobile: user.mobile || null,
        username: user.username || null,
        preferredName: profile?.preferredName && profile.preferredName.trim().toLowerCase() !== user.fullName.trim().toLowerCase() ? profile.preferredName : null,
        guardianName: primaryGuardian?.name || "—",
        guardianEmail: primaryGuardian?.email || "—",
        guardianMobile: primaryGuardian?.mobile || "—",
        status: isGraded ? "GRADED" : isSubmitted ? "SUBMITTED" : "PENDING",
        submissionId: sub?.id || null,
        submittedAt: sub?.submittedAt || null,
        mark: markNum,
        totalMarks,
        percentage,
        markedAt: sub?.markedAt || null,
        markedByName: sub?.markedBy?.fullName || null,
        markNotes: sub?.markNotes || null,
        filesCount: sub?.files?.length || 0,
      };
    });

    const averageScore =
      scoredMarks.length > 0
        ? Math.round((sumMarks / scoredMarks.length / totalMarks) * 1000) / 10
        : null;

    const highestMark = scoredMarks.length > 0 ? Math.max(...scoredMarks) : null;
    const lowestMark = scoredMarks.length > 0 ? Math.min(...scoredMarks) : null;

    return {
      assessment: {
        id: assessment.id,
        name: assessment.name,
        kind: assessment.kind,
        subject: assessment.subject,
        yearGroup: assessment.yearGroup,
        assessmentDate: assessment.assessmentDate,
        startTime: assessment.startTime,
        teacherName: assessment.teacher?.fullName || "Unassigned",
        totalMarks,
      },
      summary: {
        totalCandidates: candidateUserIds.length,
        submittedCount,
        pendingCount,
        gradedCount,
        submissionRate:
          candidateUserIds.length > 0
            ? Math.round((submittedCount / candidateUserIds.length) * 100)
            : 0,
        averageScore,
        highestMark,
        lowestMark,
      },
      students: studentRoster,
    };
  }

  async getHomeworkSubmissions(homeworkId: string) {
    const homework = await AppDataSource.getRepository(Homework).findOne({
      where: { id: homeworkId },
      relations: {
        subject: true,
        createdBy: true,
        students: { student: true },
        submissions: { student: true, markedBy: true, files: true },
      },
    });

    if (!homework) {
      throw new Error("Homework not found");
    }

    const assignedStudentsMap = new Map<string, User>();
    if (homework.students) {
      for (const st of homework.students) {
        if (st.student) assignedStudentsMap.set(st.student.id, st.student);
      }
    }
    if (homework.submissions) {
      for (const sub of homework.submissions) {
        if (sub.student) assignedStudentsMap.set(sub.student.id, sub.student);
      }
    }

    const assignedUserIds = Array.from(assignedStudentsMap.keys());
    const studentProfiles =
      assignedUserIds.length > 0
        ? await AppDataSource.getRepository(Student).find({
            where: { userId: In(assignedUserIds) },
            relations: { guardianLinks: { guardian: true } },
          })
        : [];

    const studentProfileMap = new Map<string, Student>();
    for (const sp of studentProfiles) {
      if (sp.userId) studentProfileMap.set(sp.userId, sp);
    }

    const submissionMap = new Map<string, HomeworkSubmission>();
    if (homework.submissions) {
      for (const sub of homework.submissions) {
        submissionMap.set(sub.studentId, sub);
      }
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    let submittedCount = 0;
    let gradedCount = 0;
    let pendingCount = 0;
    let lateCount = 0;
    let sumPercentages = 0;
    let scoredCount = 0;

    const studentRoster = assignedUserIds.map((userId) => {
      const user = assignedStudentsMap.get(userId)!;
      const profile = studentProfileMap.get(userId);
      const sub = submissionMap.get(userId);

      const guardians = (profile?.guardianLinks || [])
        .map((gl) => gl.guardian)
        .filter(Boolean)
        .map((g) => ({
          name: g.fullName,
          email: g.email || "",
          mobile: g.mobile || "",
        }));

      const primaryGuardian = guardians[0] || null;

      const isSubmitted = Boolean(sub && sub.status === "SUBMITTED");
      const isGraded = Boolean(sub && (sub.markedAt != null || sub.marks != null));
      const submittedDateStr = sub?.submittedAt
        ? new Date(sub.submittedAt).toISOString().slice(0, 10)
        : null;

      const isLate = Boolean(
        (submittedDateStr && submittedDateStr > homework.dueDate) ||
        (!isSubmitted && todayStr > homework.dueDate)
      );

      const marks = sub?.marks != null ? Number(sub.marks) : null;
      const maxMarks = sub?.maxMarks != null ? Number(sub.maxMarks) : 100;
      const percentage =
        marks !== null && maxMarks > 0
          ? Math.round((marks / maxMarks) * 1000) / 10
          : null;

      if (isSubmitted) {
        submittedCount++;
      } else {
        pendingCount++;
      }

      if (isLate) {
        lateCount++;
      }

      if (isGraded && percentage !== null) {
        gradedCount++;
        sumPercentages += percentage;
        scoredCount++;
      }

      return {
        studentId: user.id,
        studentName: user.fullName || "Student",
        studentEmail: user.email || null,
        studentMobile: user.mobile || null,
        username: user.username || null,
        preferredName: profile?.preferredName && profile.preferredName.trim().toLowerCase() !== user.fullName.trim().toLowerCase() ? profile.preferredName : null,
        guardianName: primaryGuardian?.name || "—",
        guardianEmail: primaryGuardian?.email || "—",
        guardianMobile: primaryGuardian?.mobile || "—",
        status: isGraded ? "GRADED" : isSubmitted ? "SUBMITTED" : "PENDING",
        isLate,
        submissionId: sub?.id || null,
        submittedAt: sub?.submittedAt || null,
        marks,
        maxMarks,
        percentage,
        feedback: sub?.feedback || null,
        markedAt: sub?.markedAt || null,
        markedByName: sub?.markedBy?.fullName || null,
        filesCount: sub?.files?.length || 0,
      };
    });

    const averageScore =
      scoredCount > 0 ? Math.round((sumPercentages / scoredCount) * 10) / 10 : null;

    return {
      homework: {
        id: homework.id,
        title: homework.title,
        subject: homework.subject?.name || "General",
        yearGroup: homework.yearGroup,
        dueDate: homework.dueDate,
        createdByName: homework.createdBy?.fullName || "Unknown",
      },
      summary: {
        totalAssigned: assignedUserIds.length,
        submittedCount,
        pendingCount,
        gradedCount,
        lateCount,
        submissionRate:
          assignedUserIds.length > 0
            ? Math.round((submittedCount / assignedUserIds.length) * 100)
            : 0,
        averageScore,
      },
      students: studentRoster,
    };
  }
}

export const adminReportsService = new AdminReportsService();
