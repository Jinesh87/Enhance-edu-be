import { AttendanceRepository } from "./attendance.repository.js";
import { AttendanceStatus } from "../../../entities/index.js";
import { AppError } from "../../../common/errors/AppError.js";

export class SharedAttendanceService {
  private readonly repo = new AttendanceRepository();

  async getLiveRollData(sessionId: string) {
    const session = await this.repo.findSessionWithClassById(sessionId);
    if (!session) {
      throw new AppError(404, "Session not found", "SESSION_NOT_FOUND");
    }

    // Get all enrolled students
    const enrols = await this.repo.findEnrolmentsByClassId(session.classId);

    // Get resolved attendance records
    const attendanceRecords = await this.repo.findAttendanceRecordsBySessionId(sessionId);

    // Get pending/syncing scans
    const pendingScans = await this.repo.findPendingScansBySessionId(sessionId);

    const roll = enrols.map((enrol) => {
      const student = enrol.student;
      const record = attendanceRecords.find((r) => r.studentId === student.id);
      const isSyncing = pendingScans.some(
        (s) => s.studentId === student.id && s.deviceSignal === "queued on device"
      );

      let status = "Not scanned";
      let time = "";

      if (isSyncing) {
        status = "Syncing...";
      } else if (record) {
        if (record.status === AttendanceStatus.PRESENT) {
          status = "Present";
        } else if (record.status === AttendanceStatus.LATE) {
          status = "Late";
        } else if (record.status === AttendanceStatus.EXCEPTION) {
          status = "Exception";
        } else if (record.status === AttendanceStatus.EXCUSED) {
          status = "Excused";
        }
        if (record.scannedAt) {
          const hours = String(record.scannedAt.getHours()).padStart(2, "0");
          const mins = String(record.scannedAt.getMinutes()).padStart(2, "0");
          const secs = String(record.scannedAt.getSeconds()).padStart(2, "0");
          time = `${hours}:${mins}:${secs}`;
        }
      }

      return {
        id: student.id,
        fullName: student.fullName,
        preferredName: student.preferredName,
        status,
        time,
      };
    });

    return {
      session: {
        className: session.class.name,
        classCode: session.class.code,
        room: session.room ?? session.class.room,
        startAt: session.startAt,
        endAt: session.endAt,
        timeZone: session.class.timeZone,
      },
      roll,
    };
  }
}

export const sharedAttendanceService = new SharedAttendanceService();
