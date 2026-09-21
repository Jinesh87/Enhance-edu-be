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
      href: isEntrance ? "/student" : `/student/work`,
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

export function homeworkGradedNotificationPayload(input: {
  homeworkId: string;
  title: string;
  marks: number | null;
  maxMarks: number | null;
  isCompleted: boolean;
}): Omit<CreateNotificationInput, "userId"> {
  const score =
    input.marks != null
      ? input.maxMarks != null
        ? `${input.marks}/${input.maxMarks}`
        : String(input.marks)
      : null;
  const bodyParts = [input.title];
  if (score) bodyParts.push(score);
  if (input.isCompleted) bodyParts.push("marked complete");
  return {
    type: "HOMEWORK_GRADED" as NotificationType,
    title: "Homework marked",
    body: bodyParts.join(" · "),
    data: {
      homeworkId: input.homeworkId,
      href: `/student/work/homework/${input.homeworkId}`,
    },
  };
}

export function assessmentMarkedNotificationPayload(input: {
  assessmentId: string;
  name: string;
  mark: number;
  totalMarks: number | null;
  kind?: string;
}): Omit<CreateNotificationInput, "userId"> {
  const isEntrance = input.kind === "ENTRANCE";
  const score =
    input.totalMarks != null
      ? `${input.mark}/${input.totalMarks}`
      : String(input.mark);
  return {
    type: "ASSESSMENT_MARKED" as NotificationType,
    title: isEntrance ? "Entrance exam marked" : "Assessment marked",
    body: `${input.name} · ${score}`,
    data: {
      assessmentId: input.assessmentId,
      kind: input.kind ?? "SCHOOL",
      href: isEntrance ? "/student" : "/student/work",
    },
  };
}

export function homeworkSubmittedNotificationPayload(input: {
  homeworkId: string;
  title: string;
  studentName: string;
}): Omit<CreateNotificationInput, "userId"> {
  return {
    type: "HOMEWORK_SUBMITTED" as NotificationType,
    title: "Homework submitted",
    body: `${input.studentName} submitted “${input.title}”.`,
    data: {
      homeworkId: input.homeworkId,
      href: `/tutor/homework`,
    },
  };
}

export function learningSetPublishedNotificationPayload(input: {
  setId: string;
  title: string;
  subjectName: string;
  generationType: string;
}): Omit<CreateNotificationInput, "userId"> {
  const kindLabel =
    input.generationType === "flashcards"
      ? "Flashcards"
      : input.generationType === "quiz"
        ? "Quiz"
        : "Revision";
  return {
    type: "LEARNING_SET_PUBLISHED" as NotificationType,
    title: "New learning set",
    body: `${input.title} · ${input.subjectName} · ${kindLabel}`,
    data: {
      setId: input.setId,
      href: `/student/learning/${input.setId}`,
    },
  };
}

export function attendanceMarkedNotificationPayload(input: {
  studentName: string;
  status: "ABSENT" | "LATE";
  sessionLabel: string;
  sessionId: string;
}): Omit<CreateNotificationInput, "userId"> {
  const statusLabel = input.status === "LATE" ? "late" : "absent";
  return {
    type: "ATTENDANCE_MARKED" as NotificationType,
    title: `Marked ${statusLabel}`,
    body: `${input.studentName} was marked ${statusLabel} for ${input.sessionLabel}.`,
    data: {
      sessionId: input.sessionId,
      status: input.status,
      href: "/guardian/students",
    },
  };
}

export function attendanceExceptionNotificationPayload(input: {
  studentName: string;
  sessionLabel: string;
  sessionId: string;
  reasonFlagged: string;
  href: string;
}): Omit<CreateNotificationInput, "userId"> {
  return {
    type: "ATTENDANCE_EXCEPTION" as NotificationType,
    title: "Attendance exception",
    body: `${input.studentName} · ${input.sessionLabel} · ${input.reasonFlagged.replace(/_/g, " ").toLowerCase()}`,
    data: {
      sessionId: input.sessionId,
      reasonFlagged: input.reasonFlagged,
      href: input.href,
    },
  };
}

export function enrollmentPendingNotificationPayload(input: {
  studentFullName: string;
  pendingEnrollmentId: string;
  isChange: boolean;
}): Omit<CreateNotificationInput, "userId"> {
  return {
    type: "ENROLLMENT_PENDING" as NotificationType,
    title: input.isChange ? "Enrolment change to review" : "New enrolment to review",
    body: `${input.studentFullName} needs your acceptance.`,
    data: {
      pendingEnrollmentId: input.pendingEnrollmentId,
      href: "/guardian/students",
    },
  };
}
