import { In } from "typeorm";
import { AppDataSource } from "../../config/data-source.js";
import { logger } from "../../config/logger.js";
import { Student } from "../../entities/index.js";
import {
  notificationsService,
  type CreateNotificationInput,
} from "./notifications.service.js";
import type { NotificationType } from "../../entities/Notification.js";

export async function notifyStudentUsers(
  studentIds: string[],
  build: (student: Student) => Omit<CreateNotificationInput, "userId"> | null,
): Promise<void> {
  const uniqueIds = [...new Set(studentIds.filter(Boolean))];
  if (uniqueIds.length === 0) return;

  try {
    const students = await AppDataSource.getRepository(Student).find({
      where: { id: In(uniqueIds) },
      select: { id: true, userId: true, fullName: true },
    });

    const inputs: CreateNotificationInput[] = [];
    for (const student of students) {
      if (!student.userId) continue;
      const payload = build(student);
      if (!payload) continue;
      inputs.push({
        userId: student.userId,
        type: payload.type,
        title: payload.title,
        body: payload.body,
        data: payload.data ?? null,
      });
    }

    if (inputs.length === 0) return;
    await notificationsService.createMany(inputs);
  } catch (error) {
    logger.warn({ err: error }, "Failed to create student notifications");
  }
}

export async function notifyUsers(
  inputs: CreateNotificationInput[],
): Promise<void> {
  const filtered = inputs.filter((row) => Boolean(row.userId));
  if (filtered.length === 0) return;
  try {
    await notificationsService.createMany(filtered);
  } catch (error) {
    logger.warn({ err: error }, "Failed to create user notifications");
  }
}

export function assessmentNotificationPayload(input: {
  assessmentId: string;
  name: string;
  subject: string;
  assessmentDate: string;
  kind?: string;
}): Omit<CreateNotificationInput, "userId"> {
  const isEntrance = input.kind === "ENTRANCE";
  return {
    type: "ASSESSMENT_CREATED" as NotificationType,
    title: isEntrance ? "New entrance exam" : "New assessment",
    body: `${input.name} · ${input.subject} · ${input.assessmentDate}`,
    data: {
      assessmentId: input.assessmentId,
      kind: input.kind ?? "SCHOOL",
      href: isEntrance
        ? "/student"
        : `/student/work`,
    },
  };
}

export function homeworkNotificationPayload(input: {
  homeworkId: string;
  title: string;
  subjectName: string;
  dueDate: string;
}): Omit<CreateNotificationInput, "userId"> {
  return {
    type: "HOMEWORK_CREATED" as NotificationType,
    title: "New homework",
    body: `${input.title} · ${input.subjectName} · due ${input.dueDate}`,
    data: {
      homeworkId: input.homeworkId,
      href: `/student/work/homework/${input.homeworkId}`,
    },
  };
}
