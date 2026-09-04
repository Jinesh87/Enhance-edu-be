import { In } from "typeorm";
import { AppDataSource } from "../../../config/data-source.js";
import { AppError } from "../../../common/errors/AppError.js";
import { UserRole } from "../../../common/constants/roles.js";
import {
  buildSessionResourceKey,
  deleteObject,
  storeUploadedObject,
} from "../../../common/storage/object-storage.js";
import {
  ClassStudent,
  Session,
  SessionLesson,
  SessionResource,
} from "../../../entities/index.js";
import { AttendanceRepository } from "../../shared/attendance/attendance.repository.js";
import { isStudentAccountableForSession } from "../../shared/attendance/student-session-eligibility.js";

export type UploadedSessionResource = {
  buffer?: Buffer;
  directStorageKey?: string;
  originalName: string;
  mimeType: string;
  size: number;
  title?: string;
  description?: string;
};

export type SessionLessonInput = {
  title: string;
  description?: string | null;
  objectives?: string | null;
  sequence?: string | null;
  watchFor?: string | null;
  notes?: string | null;
};

function toLessonDto(lesson: SessionLesson | null) {
  if (!lesson) return null;
  return {
    id: lesson.id,
    sessionId: lesson.sessionId,
    title: lesson.title,
    description: lesson.description,
    objectives: lesson.objectives,
    sequence: lesson.sequence,
    watchFor: lesson.watchFor,
    notes: lesson.notes,
    updatedAt: lesson.updatedAt.toISOString(),
  };
}

function toResourceDto(resource: SessionResource) {
  return {
    id: resource.id,
    sessionId: resource.sessionId,
    title: resource.title,
    description: resource.description,
    originalName: resource.originalName,
    mimeType: resource.mimeType,
    byteSize: resource.byteSize,
    sortOrder: resource.sortOrder,
    createdAt: resource.createdAt.toISOString(),
  };
}

function resourceKindFromMime(mimeType: string): "DOCUMENT" | "PAPER" | "SLIDES" {
  if (mimeType.includes("pdf")) return "PAPER";
  if (mimeType.startsWith("image/")) return "SLIDES";
  return "DOCUMENT";
}

export class SessionLessonService {
  private readonly attendanceRepo = new AttendanceRepository();
  private readonly lessons = AppDataSource.getRepository(SessionLesson);
  private readonly resources = AppDataSource.getRepository(SessionResource);
  private readonly classStudents = AppDataSource.getRepository(ClassStudent);

  private async loadSession(sessionId: string): Promise<Session> {
    const session = await this.attendanceRepo.findSessionWithClassById(sessionId);
    if (!session) {
      throw new AppError(404, "Session not found", "SESSION_NOT_FOUND");
    }
    if (session.assessmentId) {
      throw new AppError(
        400,
        "Use assessment resources for exam sessions",
        "ASSESSMENT_SESSION",
      );
    }
    if (!session.classId || !session.class) {
      throw new AppError(404, "Session not found", "SESSION_NOT_FOUND");
    }
    return session;
  }

  private teacherOwnsSession(
    session: Session,
    userId: string,
    role: UserRole,
  ): boolean {
    if (role === UserRole.SUPER_ADMIN || role === UserRole.OFFICE_STAFF) {
      return true;
    }
    if (session.teacherId === userId) return true;
    if (session.class?.teacher?.id === userId) return true;
    return false;
  }

  private async assertTeacherAccess(
    sessionId: string,
    userId: string,
    role: UserRole,
  ) {
    const session = await this.loadSession(sessionId);
    if (!this.teacherOwnsSession(session, userId, role)) {
      throw new AppError(403, "Access denied", "SESSION_ACCESS_DENIED");
    }
    return session;
  }

  private async assertStudentEnrolled(sessionId: string, studentUserId: string) {
    const session = await this.loadSession(sessionId);
    if (!session.classId) {
      throw new AppError(
        403,
        "You are not enrolled in this class",
        "NOT_ENROLLED",
      );
    }
    const enrolled = await this.classStudents.findOne({
      where: {
        classId: session.classId,
        studentId: studentUserId,
      },
    });
    if (
      !enrolled ||
      !isStudentAccountableForSession(session, enrolled.createdAt)
    ) {
      throw new AppError(
        403,
        "You are not enrolled in this class",
        "NOT_ENROLLED",
      );
    }
    return session;
  }

  async getTeacherWorkspace(sessionId: string, userId: string, role: UserRole) {
    const session = await this.assertTeacherAccess(sessionId, userId, role);
    const [lesson, resourceRows] = await Promise.all([
      this.lessons.findOne({ where: { sessionId } }),
      this.resources.find({
        where: { sessionId },
        order: { sortOrder: "ASC", createdAt: "ASC" },
      }),
    ]);

    return {
      session: {
        id: session.id,
        classId: session.classId,
        className: session.class?.name ?? "Class",
        classCode: session.class?.code ?? "",
        subject: session.class?.subject ?? "",
        lesson: session.class?.lesson ?? null,
        room: session.room ?? session.class?.room ?? null,
        startAt: session.startAt.toISOString(),
        endAt: session.endAt.toISOString(),
        gracePeriodMinutes: session.gracePeriodMinutes,
        timeZone: session.class?.timeZone ?? null,
        contentGroup: session.class?.contentGroup ?? null,
      },
      lesson: toLessonDto(lesson),
      resources: resourceRows.map(toResourceDto),
    };
  }

  async upsertLesson(
    sessionId: string,
    userId: string,
    role: UserRole,
    input: SessionLessonInput,
  ) {
    await this.assertTeacherAccess(sessionId, userId, role);
    const title = input.title.trim();
    if (!title) {
      throw new AppError(400, "Title is required", "TITLE_REQUIRED");
    }

    let lesson = await this.lessons.findOne({ where: { sessionId } });
    if (lesson) {
      lesson.title = title;
      lesson.description = input.description?.trim() || null;
      lesson.objectives = input.objectives?.trim() || null;
      lesson.sequence = input.sequence?.trim() || null;
      lesson.watchFor = input.watchFor?.trim() || null;
      lesson.notes = input.notes?.trim() || null;
      lesson.updatedById = userId;
    } else {
      lesson = this.lessons.create({
        sessionId,
        title,
        description: input.description?.trim() || null,
        objectives: input.objectives?.trim() || null,
        sequence: input.sequence?.trim() || null,
        watchFor: input.watchFor?.trim() || null,
        notes: input.notes?.trim() || null,
        updatedById: userId,
      });
    }

    const saved = await this.lessons.save(lesson);
    return { lesson: toLessonDto(saved) };
  }

  async listResources(sessionId: string, userId: string, role: UserRole) {
    await this.assertTeacherAccess(sessionId, userId, role);
    const rows = await this.resources.find({
      where: { sessionId },
      order: { sortOrder: "ASC", createdAt: "ASC" },
    });
    return { resources: rows.map(toResourceDto) };
  }

  async uploadResources(
    sessionId: string,
    userId: string,
    role: UserRole,
    uploads: UploadedSessionResource[],
  ) {
    if (uploads.length === 0) {
      throw new AppError(400, "Choose at least one file", "NO_FILES");
    }
    await this.assertTeacherAccess(sessionId, userId, role);

    const existingCount = await this.resources.count({ where: { sessionId } });
    const created: SessionResource[] = [];

    for (const [index, upload] of uploads.entries()) {
      const resourceId = crypto.randomUUID();
      const key = buildSessionResourceKey({
        sessionId,
        resourceId,
        fileName: upload.originalName,
      });
      await storeUploadedObject({
        finalKey: key,
        contentType: upload.mimeType,
        buffer: upload.buffer,
        directStorageKey: upload.directStorageKey,
        byteSize: upload.size,
      });
      created.push(
        this.resources.create({
          id: resourceId,
          sessionId,
          uploadedById: userId,
          title: upload.title?.trim() || upload.originalName,
          description: upload.description?.trim() || null,
          storageKey: key,
          originalName: upload.originalName,
          mimeType: upload.mimeType,
          byteSize: upload.size,
          sortOrder: existingCount + index,
        }),
      );
    }

    const saved = await this.resources.save(created);
    return { resources: saved.map(toResourceDto) };
  }

  async updateResource(
    sessionId: string,
    resourceId: string,
    userId: string,
    role: UserRole,
    input: { title?: string; description?: string | null },
  ) {
    await this.assertTeacherAccess(sessionId, userId, role);
    const resource = await this.resources.findOne({
      where: { id: resourceId, sessionId },
    });
    if (!resource) {
      throw new AppError(404, "Resource not found", "RESOURCE_NOT_FOUND");
    }
    if (input.title !== undefined) {
      const title = input.title.trim();
      if (!title) {
        throw new AppError(400, "Title is required", "TITLE_REQUIRED");
      }
      resource.title = title;
    }
    if (input.description !== undefined) {
      resource.description = input.description?.trim() || null;
    }
    const saved = await this.resources.save(resource);
    return { resource: toResourceDto(saved) };
  }

  async removeResource(
    sessionId: string,
    resourceId: string,
    userId: string,
    role: UserRole,
  ) {
    await this.assertTeacherAccess(sessionId, userId, role);
    const resource = await this.resources.findOne({
      where: { id: resourceId, sessionId },
    });
    if (!resource) {
      throw new AppError(404, "Resource not found", "RESOURCE_NOT_FOUND");
    }
    await deleteObject(resource.storageKey);
    await this.resources.remove(resource);
    return { ok: true };
  }

  async listResourcesForStudent(sessionId: string, studentUserId: string) {
    await this.assertStudentEnrolled(sessionId, studentUserId);
    const rows = await this.resources.find({
      where: { sessionId },
      order: { sortOrder: "ASC", createdAt: "ASC" },
    });
    const now = Date.now();
    return rows.map((resource) => ({
      id: resource.id,
      title: resource.title,
      kind: resourceKindFromMime(resource.mimeType),
      description: resource.description,
      releasedAt: resource.createdAt.toISOString(),
      released: true,
      downloadable: true,
    }));
  }

  async getLessonForStudent(sessionId: string, studentUserId: string) {
    await this.assertStudentEnrolled(sessionId, studentUserId);
    const lesson = await this.lessons.findOne({ where: { sessionId } });
    return toLessonDto(lesson);
  }

  async getResourceForStudent(
    sessionId: string,
    resourceId: string,
    studentUserId: string,
  ) {
    await this.assertStudentEnrolled(sessionId, studentUserId);
    const resource = await this.resources.findOne({
      where: { id: resourceId, sessionId },
    });
    if (!resource) {
      throw new AppError(404, "Resource not found", "RESOURCE_NOT_FOUND");
    }
    return {
      storageKey: resource.storageKey,
      originalName: resource.originalName,
      mimeType: resource.mimeType,
    };
  }

  async listResourcesForSessions(sessionIds: string[]) {
    if (sessionIds.length === 0) return new Map<string, SessionResource[]>();
    const rows = await this.resources.find({
      where: { sessionId: In(sessionIds) },
      order: { sortOrder: "ASC", createdAt: "ASC" },
    });
    const map = new Map<string, SessionResource[]>();
    for (const row of rows) {
      const list = map.get(row.sessionId) ?? [];
      list.push(row);
      map.set(row.sessionId, list);
    }
    return map;
  }

  async listLessonsForSessions(sessionIds: string[]) {
    if (sessionIds.length === 0) return new Map<string, SessionLesson>();
    const rows = await this.lessons.find({
      where: { sessionId: In(sessionIds) },
    });
    return new Map(rows.map((row) => [row.sessionId, row]));
  }
}

export const sessionLessonService = new SessionLessonService();
