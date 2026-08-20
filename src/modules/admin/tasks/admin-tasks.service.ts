import { AppDataSource } from "../../../config/data-source.js";
import { AppError } from "../../../common/errors/AppError.js";
import { UserRole } from "../../../common/constants/roles.js";
import { logger } from "../../../config/logger.js";
import {
  AttendanceStatus,
  Task,
  TaskStatus,
  TaskType,
} from "../../../entities/index.js";
import { AttendanceRepository } from "../../shared/attendance/attendance.repository.js";
import { adminNotificationManager } from "./admin-task-updates.js";

function graceClosedAt(startAt: Date, gracePeriodMinutes: number): Date {
  return new Date(startAt.getTime() + gracePeriodMinutes * 60_000);
}

function toTaskDto(task: Task) {
  const sessionName = task.session?.class
    ? `${task.session.class.code} — ${task.session.class.name}`
    : "Session";

  return {
    id: task.id,
    type: task.type,
    status: task.status,
    title: task.title,
    source: "Attendance",
    assignedRole: task.assignedRole,
    dueAt: task.dueAt,
    completedAt: task.completedAt,
    createdAt: task.createdAt,
    student: task.student
      ? {
          id: task.student.id,
          fullName: task.student.fullName,
          preferredName: task.student.preferredName,
        }
      : null,
    session: task.session
      ? {
          id: task.session.id,
          name: sessionName,
          startAt: task.session.startAt,
          graceClosedAt: graceClosedAt(
            task.session.startAt,
            task.session.gracePeriodMinutes,
          ),
        }
      : null,
  };
}

export class AdminTasksService {
  private readonly tasks = AppDataSource.getRepository(Task);
  private readonly attendance = new AttendanceRepository();

  async list(filters?: { page?: number; limit?: number }) {
    await this.syncAbsenceChaseTasks();

    const tasks = await this.tasks.find({
      where: { assignedRole: UserRole.SUPER_ADMIN },
      relations: {
        student: true,
        session: { class: true },
      },
      order: { dueAt: "ASC", createdAt: "DESC" },
    });

    const now = Date.now();
    const open = tasks.filter((task) => task.status === TaskStatus.OPEN);
    const overdue = open.filter((task) => task.dueAt.getTime() < now);

    const total = tasks.length;
    let paginatedTasks = tasks;
    if (filters?.page && filters?.limit) {
      const start = (filters.page - 1) * filters.limit;
      paginatedTasks = tasks.slice(start, start + filters.limit);
    }

    return {
      counts: {
        open: open.length,
        overdue: overdue.length,
        awaitingApproval: 0,
        unassigned: 0,
      },
      tasks: paginatedTasks.map(toTaskDto),
      total,
    };
  }

  async complete(id: string, actorId: string) {
    const task = await this.tasks.findOne({
      where: { id },
      relations: {
        student: true,
        session: { class: true },
      },
    });

    if (!task) {
      throw new AppError(404, "Task not found", "TASK_NOT_FOUND");
    }

    if (task.status === TaskStatus.DONE) {
      return toTaskDto(task);
    }

    task.status = TaskStatus.DONE;
    task.completedAt = new Date();
    task.completedByUserId = actorId;
    await this.tasks.save(task);

    const openCount = await this.openCountForRole(task.assignedRole);
    adminNotificationManager.broadcast({
      type: "TASK_COMPLETED",
      role: task.assignedRole,
      count: 1,
      openCount,
      title: "Task completed",
    });

    return toTaskDto(task);
  }

  async syncFuturePendingRecords(): Promise<void> {
    const sessions = await this.attendance.findActiveOrFutureSessions();
    for (const session of sessions) {
      const enrolments = await this.attendance.findEnrolmentsByClassId(
        session.classId,
      );
      const records = await this.attendance.findAttendanceRecordsBySessionId(
        session.id,
      );
      const recordByStudent = new Set(records.map((r) => r.studentId));

      for (const enrolment of enrolments) {
        if (!recordByStudent.has(enrolment.studentId)) {
          await this.attendance.createAttendanceRecord({
            sessionId: session.id,
            studentId: enrolment.studentId,
            status: AttendanceStatus.PENDING,
            scannedAt: null,
          });
        }
      }
    }
  }

  async syncAbsenceChaseTasks(): Promise<number> {
    await this.syncFuturePendingRecords();

    const since = new Date();
    since.setDate(since.getDate() - 14);

    const sessions = await this.attendance.findSessionsStartedSince(since);
    const now = Date.now();
    let created = 0;

    for (const session of sessions) {
      const closedAt = graceClosedAt(
        session.startAt,
        session.gracePeriodMinutes,
      );
      if (closedAt.getTime() > now) continue;

      const enrolments = await this.attendance.findEnrolmentsByClassId(
        session.classId,
      );
      const records = await this.attendance.findAttendanceRecordsBySessionId(
        session.id,
      );
      const recordByStudent = new Map(
        records.map((record) => [record.studentId, record]),
      );

      for (const enrolment of enrolments) {
        const record = recordByStudent.get(enrolment.studentId);
        if (
          record &&
          record.status !== AttendanceStatus.PENDING &&
          record.status !== AttendanceStatus.ABSENT
        ) {
          continue;
        }

        let attendanceRecord = record;
        if (record && record.status === AttendanceStatus.PENDING) {
          record.status = AttendanceStatus.ABSENT;
          attendanceRecord = await this.attendance.saveAttendanceRecord(record);
        } else if (!record) {
          attendanceRecord = await this.attendance.createAttendanceRecord({
            sessionId: session.id,
            studentId: enrolment.studentId,
            status: AttendanceStatus.ABSENT,
            scannedAt: null,
          });
        }

        const existing = await this.tasks.findOne({
          where: {
            type: TaskType.ABSENCE_CHASE,
            sessionId: session.id,
            studentId: enrolment.studentId,
          },
        });
        if (existing) continue;

        const studentName =
          enrolment.student.preferredName || enrolment.student.fullName;
        const classLabel = session.class?.code ?? "class";

        const task = this.tasks.create({
          type: TaskType.ABSENCE_CHASE,
          status: TaskStatus.OPEN,
          assignedRole: UserRole.SUPER_ADMIN,
          title: `Chase absence — ${studentName} · ${classLabel}`,
          studentId: enrolment.studentId,
          sessionId: session.id,
          attendanceRecordId: attendanceRecord!.id,
          dueAt: session.endAt,
        });

        try {
          await this.tasks.save(task);
          created += 1;
        } catch (error) {
          logger.warn(
            {
              err: error,
              sessionId: session.id,
              studentId: enrolment.studentId,
            },
            "Skipped duplicate absence chase task",
          );
        }
      }
    }

    if (created > 0) {
      logger.info({ created }, "Absence chase tasks created");
      const openCount = await this.openCountForRole(UserRole.SUPER_ADMIN);
      adminNotificationManager.broadcast({
        type: "TASKS_CREATED",
        role: UserRole.SUPER_ADMIN,
        count: created,
        openCount,
        title:
          created === 1 ? "New absence chase" : `${created} new absence chases`,
        body: "Open Tasks to follow up.",
      });
    }

    return created;
  }

  private openCountForRole(role: UserRole) {
    return this.tasks.count({
      where: { assignedRole: role, status: TaskStatus.OPEN },
    });
  }
}

export const adminTasksService = new AdminTasksService();
