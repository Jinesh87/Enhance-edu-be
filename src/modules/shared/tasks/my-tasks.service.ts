import { In, LessThan } from "typeorm";
import { AppDataSource } from "../../../config/data-source.js";
import { AppError } from "../../../common/errors/AppError.js";
import { UserRole, UserStatus } from "../../../common/constants/roles.js";
import { Task, TaskStatus, User } from "../../../entities/index.js";
import { adminAttendanceService } from "../../admin/attendance/admin-attendance.service.js";
import { adminNotificationManager } from "../../admin/tasks/admin-task-updates.js";
import { adminTasksService } from "../../admin/tasks/admin-tasks.service.js";
import {
  notifyUsers,
  taskCompletedNotificationPayload,
} from "../../notifications/domain-notifications.js";
import { broadcastRollUpdate } from "../attendance/broadcast-roll-update.js";
import type { CorrectableStatus, MyTaskTab } from "./my-tasks.validation.js";

const STATUS_LABELS: Record<CorrectableStatus, string> = {
  PRESENT: "Present",
  LATE: "Late",
  ABSENT: "Absent",
  EXCUSED: "Excused",
};

function sessionLabel(task: Task): string {
  const session = task.session;
  if (!session) return "Session";
  return `${session.class?.code ?? "EXAM"} — ${session.class?.name ?? session.assessment?.name ?? "Session"}`;
}

function toMyTaskSummary(task: Task) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    dueAt: task.dueAt,
    completedAt: task.completedAt,
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
          name: sessionLabel(task),
          startAt: task.session.startAt,
          graceClosedAt: new Date(
            task.session.startAt.getTime() +
              task.session.gracePeriodMinutes * 60_000,
          ),
        }
      : null,
  };
}

export class MyTasksService {
  private readonly tasks = AppDataSource.getRepository(Task);

  async list(
    actorId: string,
    filters: {
      tab: MyTaskTab;
      page: number;
      limit: number;
      search?: string;
      filter?: string;
      sortOrder?: "ASC" | "DESC";
    },
  ) {
    const status =
      filters.tab === "completed" ? TaskStatus.DONE : TaskStatus.OPEN;

    const qb = this.tasks
      .createQueryBuilder("task")
      .leftJoinAndSelect("task.student", "student")
      .leftJoinAndSelect("task.session", "session")
      .leftJoinAndSelect("session.class", "class")
      .leftJoinAndSelect("session.assessment", "assessment")
      .where("task.assignedUserId = :actorId", { actorId })
      .andWhere("task.status = :status", { status });

    if (filters.search && filters.search.trim()) {
      const search = `%${filters.search.trim()}%`;
      qb.andWhere(
        "(student.fullName ILIKE :search OR student.preferredName ILIKE :search OR task.title ILIKE :search OR class.name ILIKE :search OR class.code ILIKE :search OR assessment.name ILIKE :search)",
        { search },
      );
    }

    if (filters.filter === "overdue" && status === TaskStatus.OPEN) {
      qb.andWhere("task.dueAt < :now", { now: new Date() });
    } else if (filters.filter === "due_today" && status === TaskStatus.OPEN) {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);
      qb.andWhere("task.dueAt >= :startOfDay AND task.dueAt <= :endOfDay", {
        startOfDay,
        endOfDay,
      });
    }

    if (status === TaskStatus.OPEN) {
      qb.orderBy("task.dueAt", filters.sortOrder === "DESC" ? "DESC" : "ASC");
    } else {
      qb.orderBy(
        "task.completedAt",
        filters.sortOrder === "ASC" ? "ASC" : "DESC",
      );
    }

    qb.skip((filters.page - 1) * filters.limit).take(filters.limit);

    const [[rows, total], pending, overdue, completed] = await Promise.all([
      qb.getManyAndCount(),
      this.tasks.count({
        where: { assignedUserId: actorId, status: TaskStatus.OPEN },
      }),
      this.tasks.count({
        where: {
          assignedUserId: actorId,
          status: TaskStatus.OPEN,
          dueAt: LessThan(new Date()),
        },
      }),
      this.tasks.count({
        where: { assignedUserId: actorId, status: TaskStatus.DONE },
      }),
    ]);

    return {
      counts: { pending, overdue, completed },
      tasks: rows.map(toMyTaskSummary),
      total,
    };
  }

  async getById(actorId: string, id: string) {
    const task = await this.requireOwnTask(actorId, id);
    return this.toDetail(task);
  }

  async complete(
    actorId: string,
    id: string,
    input: { status: CorrectableStatus; reason: string },
  ) {
    const task = await this.requireOwnTask(actorId, id);

    if (task.status !== TaskStatus.OPEN) {
      throw new AppError(409, "This task is already completed", "TASK_ALREADY_COMPLETED");
    }
    if (!task.attendanceRecordId) {
      throw new AppError(
        400,
        "This task has no attendance record to correct",
        "TASK_RECORD_MISSING",
      );
    }

    // Goes through the same path as the admin Correct Records page, so the
    // audit history, guardian notice and trial-enquiry sync stay consistent.
    const { record } = await adminAttendanceService.correctAttendanceRecord(
      task.attendanceRecordId,
      input.status,
      input.reason,
      actorId,
    );

    task.status = TaskStatus.DONE;
    task.completedAt = new Date();
    task.completedByUserId = actorId;
    await this.tasks.save(task);

    await broadcastRollUpdate(record.sessionId);
    await this.notifyAdminsOfCompletion(task, actorId, input.status);

    return this.toDetail(await this.requireOwnTask(actorId, id));
  }

  private async requireOwnTask(actorId: string, id: string): Promise<Task> {
    const task = await this.tasks.findOne({
      where: { id, assignedUserId: actorId },
      relations: {
        student: true,
        assignedUser: true,
        completedByUser: true,
        session: { class: true, assessment: true },
      },
    });
    if (!task) {
      throw new AppError(404, "Task not found", "TASK_NOT_FOUND");
    }
    return task;
  }

  private async toDetail(task: Task) {
    const [record, guardians] = await Promise.all([
      task.attendanceRecordId
        ? adminAttendanceService.getCorrectionRecord(task.attendanceRecordId)
        : Promise.resolve(null),
      adminAttendanceService.findGuardiansForStudentUser(task.studentId),
    ]);

    return {
      ...toMyTaskSummary(task),
      assignedTo: task.assignedUser?.fullName ?? null,
      completedByName: task.completedByUser?.fullName ?? null,
      guardians,
      record,
    };
  }

  private async notifyAdminsOfCompletion(
    task: Task,
    actorId: string,
    status: CorrectableStatus,
  ): Promise<void> {
    const admins = await AppDataSource.getRepository(User).find({
      where: {
        role: In([UserRole.SUPER_ADMIN, UserRole.OFFICE_STAFF]),
        status: UserStatus.ACTIVE,
      },
      select: { id: true, role: true, modulePermissions: true },
    });

    const recipients = admins.filter(
      (admin) =>
        admin.id !== actorId &&
        (admin.role === UserRole.SUPER_ADMIN ||
          (admin.modulePermissions ?? []).includes("tasks")),
    );

    const staffName = task.assignedUser?.fullName ?? "Staff";
    const studentName =
      task.student?.preferredName || task.student?.fullName || "Student";
    const payload = taskCompletedNotificationPayload({
      taskId: task.id,
      staffName,
      studentName,
      statusLabel: STATUS_LABELS[status],
    });

    await notifyUsers(
      recipients.map((admin) => ({ userId: admin.id, ...payload })),
    );

    adminNotificationManager.broadcast({
      type: "TASK_COMPLETED",
      role: task.assignedRole,
      count: 1,
      openCount: await adminTasksService.openCount(),
      title: payload.title,
      body: payload.body,
    });
  }
}

export const myTasksService = new MyTasksService();
