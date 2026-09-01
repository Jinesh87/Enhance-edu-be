import { Brackets, In } from "typeorm";
import { EnrollmentStatus } from "../../../common/constants/enrollment.js";
import { UserRole } from "../../../common/constants/roles.js";
import { AppError } from "../../../common/errors/AppError.js";
import {
  buildHomeworkAttachmentKey,
  deleteObject,
  getObjectBuffer,
  putObject,
} from "../../../common/storage/object-storage.js";
import {
  termYearLevelNumber,
  yearLevelsCompatible,
} from "../../../common/utils/year-level.js";
import { AppDataSource } from "../../../config/data-source.js";
import {
  Enrollment,
  Homework,
  HomeworkAttachment,
  HomeworkStudent,
  HomeworkSubmission,
  HomeworkSubmissionFile,
  Subject,
  TeacherSubject,
  Term,
} from "../../../entities/index.js";

export type CreateTeacherHomeworkInput = {
  title: string;
  description?: string | null;
  termId: string;
  subjectId: string;
  teacherId?: string | null;
  yearGroup: string;
  dueDate: string;
  maxMarks?: number | null;
};

export type UpdateTeacherHomeworkInput = {
  title?: string;
  description?: string | null;
  teacherId?: string | null;
  dueDate?: string;
  maxMarks?: number | null;
  removeAttachmentIds?: string[] | string;
};

export type UploadedHomeworkAttachment = {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  size: number;
};

function sameText(left: string | null | undefined, right: string) {
  return (left ?? "").trim().toLowerCase() === right.trim().toLowerCase();
}

function toTermDto(term: Term) {
  return {
    id: term.id,
    name: term.name,
    startDate: term.startDate,
    endDate: term.endDate,
    academicYear: term.academicYear
      ? {
          id: term.academicYear.id,
          year: term.academicYear.year,
          displayName: term.academicYear.displayName,
        }
      : null,
    yearLevel: term.yearLevel
      ? {
          id: term.yearLevel.id,
          name: term.yearLevel.name,
          sequence: term.yearLevel.sequence,
        }
      : null,
  };
}

function toSubjectDto(subject: Subject) {
  return {
    id: subject.id,
    name: subject.name,
    yearLevel: subject.yearLevel
      ? {
          id: subject.yearLevel.id,
          name: subject.yearLevel.name,
          sequence: subject.yearLevel.sequence,
        }
      : null,
  };
}

function toAttachmentDto(attachment: HomeworkAttachment) {
  return {
    id: attachment.id,
    originalName: attachment.originalName,
    mimeType: attachment.mimeType,
    byteSize: attachment.byteSize,
    createdAt: attachment.createdAt.toISOString(),
  };
}

function isAllowedFile(upload: UploadedHomeworkAttachment) {
  return (
    upload.mimeType.startsWith("image/") ||
    upload.mimeType === "application/pdf" ||
    upload.mimeType === "text/plain" ||
    upload.mimeType === "text/csv" ||
    upload.mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    upload.mimeType === "application/msword"
  );
}

export class TeacherHomeworkService {
  private readonly homework = AppDataSource.getRepository(Homework);
  private readonly attachments = AppDataSource.getRepository(HomeworkAttachment);
  private readonly assignees = AppDataSource.getRepository(HomeworkStudent);
  private readonly submissions = AppDataSource.getRepository(HomeworkSubmission);
  private readonly submissionFiles = AppDataSource.getRepository(HomeworkSubmissionFile);
  private readonly enrollments = AppDataSource.getRepository(Enrollment);
  private readonly subjects = AppDataSource.getRepository(Subject);
  private readonly teacherSubjects = AppDataSource.getRepository(TeacherSubject);
  private readonly terms = AppDataSource.getRepository(Term);

  async lookups(userId: string, role: UserRole) {
    const terms = await this.terms.find({
      where: { isTrial: false },
      relations: { academicYear: true, yearLevel: true },
      order: { startDate: "ASC" },
    });

    let subjects: Subject[];
    if (role === UserRole.STAFF) {
      const rows = await this.teacherSubjects.find({
        where: { teacherId: userId },
        relations: { subject: { yearLevel: true } },
        order: { createdAt: "ASC" },
      });
      subjects = rows
        .map((row) => row.subject)
        .filter((subject): subject is Subject => Boolean(subject));
    } else {
      subjects = await this.subjects.find({
        relations: { yearLevel: true },
        order: { name: "ASC" },
      });
    }

    return {
      terms: terms.map(toTermDto),
      subjects: subjects.map(toSubjectDto),
    };
  }

  async list(
    userId: string,
    role: UserRole,
    filters: {
      page?: number;
      limit?: number;
      search?: string;
      academicYear?: number | string;
      yearGroup?: string;
      termId?: string;
      subjectId?: string;
    } = {},
  ) {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 10));
    const skip = (page - 1) * limit;

    const qb = this.homework
      .createQueryBuilder("homework")
      .leftJoinAndSelect("homework.attachments", "attachments")
      .leftJoinAndSelect("homework.subject", "subject")
      .leftJoinAndSelect("subject.yearLevel", "subjectYearLevel")
      .leftJoinAndSelect("homework.term", "term")
      .leftJoinAndSelect("term.academicYear", "academicYear")
      .leftJoinAndSelect("term.yearLevel", "termYearLevel")
      .leftJoinAndSelect("homework.createdBy", "createdBy");

    if (role === UserRole.STAFF) {
      qb.andWhere("homework.createdById = :userId", { userId });
    }

    if (filters.search && filters.search.trim()) {
      const search = `%${filters.search.trim()}%`;
      qb.andWhere(
        new Brackets((sub) => {
          sub
            .where("homework.title ILIKE :search", { search })
            .orWhere("homework.description ILIKE :search", { search })
            .orWhere("subject.name ILIKE :search", { search });
        }),
      );
    }

    if (filters.academicYear) {
      const year = Number(filters.academicYear);
      if (!Number.isNaN(year)) {
        qb.andWhere("academicYear.year = :year", { year });
      }
    }

    if (filters.yearGroup && filters.yearGroup.trim()) {
      qb.andWhere("LOWER(homework.yearGroup) = LOWER(:yearGroup)", {
        yearGroup: filters.yearGroup.trim(),
      });
    }

    if (filters.termId && filters.termId.trim()) {
      const termVal = filters.termId.trim();
      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          termVal,
        );
      if (isUuid) {
        qb.andWhere("homework.termId = :termId", { termId: termVal });
      } else {
        qb.andWhere("LOWER(term.name) = LOWER(:termName)", {
          termName: termVal,
        });
      }
    }

    if (filters.subjectId && filters.subjectId.trim()) {
      const subjVal = filters.subjectId.trim();
      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          subjVal,
        );
      if (isUuid) {
        qb.andWhere("homework.subjectId = :subjectId", { subjectId: subjVal });
      } else {
        qb.andWhere("LOWER(subject.name) = LOWER(:subjectName)", {
          subjectName: subjVal,
        });
      }
    }

    qb.orderBy("homework.createdAt", "DESC")
      .skip(skip)
      .take(limit);

    const [items, total] = await qb.getManyAndCount();
    const rows = await Promise.all(
      items.map(async (item) => this.toHomeworkDto(item)),
    );

    return {
      homework: rows,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async create(
    userId: string,
    role: UserRole,
    input: CreateTeacherHomeworkInput,
    uploads: UploadedHomeworkAttachment[],
  ) {
    if (uploads.length > 20) {
      throw new AppError(400, "Too many files (max 20)", "TOO_MANY_FILES");
    }
    for (const upload of uploads) {
      if (!isAllowedFile(upload)) {
        throw new AppError(
          400,
          "Only images, PDF, Word, or text files are allowed",
          "INVALID_FILE_TYPE",
        );
      }
      if (upload.size > 15 * 1024 * 1024) {
        throw new AppError(
          400,
          "Each file must be under 15MB",
          "FILE_TOO_LARGE",
        );
      }
    }

    const term = await this.terms.findOne({
      where: { id: input.termId },
      relations: { academicYear: true, yearLevel: true },
    });
    if (!term || term.isTrial) {
      throw new AppError(404, "Term not found", "TERM_NOT_FOUND");
    }
    if (!sameText(term.yearLevel?.name, input.yearGroup)) {
      throw new AppError(
        400,
        "Selected term does not match the year level",
        "TERM_YEAR_LEVEL_MISMATCH",
      );
    }

    const subject = await this.subjects.findOne({
      where: { id: input.subjectId },
      relations: { yearLevel: true },
    });
    if (!subject) {
      throw new AppError(404, "Subject not found", "SUBJECT_NOT_FOUND");
    }
    if (subject.yearLevel?.name && !sameText(subject.yearLevel.name, input.yearGroup)) {
      throw new AppError(
        400,
        "Selected subject does not match the year level",
        "SUBJECT_YEAR_LEVEL_MISMATCH",
      );
    }
    await this.assertSubjectAccess(userId, role, subject.id);

    const studentIds = await this.resolveStudentIds(term, subject.id);
    if (studentIds.length === 0) {
      throw new AppError(
        400,
        "No enrolled students found for this subject and year level",
        "NO_HOMEWORK_STUDENTS",
      );
    }

    const targetCreatedById =
      role !== UserRole.STAFF && input.teacherId
        ? input.teacherId
        : userId;

    const homework = await this.homework.save(
      this.homework.create({
        title: input.title.trim(),
        description: input.description?.trim() || null,
        dueDate: input.dueDate,
        maxMarks: input.maxMarks != null ? input.maxMarks : 100,
        termId: term.id,
        subjectId: subject.id,
        yearGroup: input.yearGroup.trim(),
        createdById: targetCreatedById,
      }),
    );

    await this.assignees.save(
      studentIds.map((studentId) =>
        this.assignees.create({ homeworkId: homework.id, studentId }),
      ),
    );

    try {
      await this.storeAttachments(homework.id, targetCreatedById, uploads);
    } catch (error) {
      await this.homework.remove(homework);
      throw error;
    }

    const saved = await this.homework.findOneOrFail({
      where: { id: homework.id },
      relations: {
        attachments: true,
        subject: { yearLevel: true },
        term: { academicYear: true, yearLevel: true },
        createdBy: true,
      },
    });
    return { homework: await this.toHomeworkDto(saved) };
  }

  async update(
    userId: string,
    role: UserRole,
    homeworkId: string,
    input: UpdateTeacherHomeworkInput,
    uploads: UploadedHomeworkAttachment[],
  ) {
    for (const upload of uploads) {
      if (!isAllowedFile(upload)) {
        throw new AppError(
          400,
          `File type not supported for ${upload.originalName}`,
          "INVALID_FILE_TYPE",
        );
      }
      if (upload.size > 15 * 1024 * 1024) {
        throw new AppError(
          400,
          "Each file must be under 15MB",
          "FILE_TOO_LARGE",
        );
      }
    }

    const homework = await this.homework.findOne({
      where: { id: homeworkId },
      relations: {
        attachments: true,
        subject: { yearLevel: true },
        term: { academicYear: true, yearLevel: true },
      },
    });
    if (!homework) {
      throw new AppError(404, "Homework not found", "NOT_FOUND");
    }

    if (role === UserRole.STAFF && homework.createdById !== userId) {
      await this.assertSubjectAccess(userId, role, homework.subjectId);
    }

    if (input.title !== undefined) {
      homework.title = input.title.trim();
    }
    if (input.description !== undefined) {
      homework.description = input.description?.trim() || null;
    }
    if (input.dueDate !== undefined) {
      homework.dueDate = input.dueDate;
    }
    if (input.maxMarks !== undefined) {
      homework.maxMarks = input.maxMarks != null ? input.maxMarks : 100;
    }
    if (role !== UserRole.STAFF && input.teacherId !== undefined) {
      if (input.teacherId) {
        homework.createdById = input.teacherId;
      }
    }

    await this.homework.save(homework);

    // Remove specified attachments
    let removeIds: string[] = [];
    if (Array.isArray(input.removeAttachmentIds)) {
      removeIds = input.removeAttachmentIds;
    } else if (typeof input.removeAttachmentIds === "string") {
      try {
        const parsed = JSON.parse(input.removeAttachmentIds);
        removeIds = Array.isArray(parsed) ? parsed : [input.removeAttachmentIds];
      } catch {
        removeIds = [input.removeAttachmentIds];
      }
    }

    if (removeIds.length > 0) {
      const attachmentsToDelete = await this.attachments.find({
        where: { id: In(removeIds), homeworkId },
      });
      for (const att of attachmentsToDelete) {
        await deleteObject(att.storageKey);
        await this.attachments.remove(att);
      }
    }

    // Add new attachments
    if (uploads.length > 0) {
      await this.storeAttachments(homework.id, userId, uploads);
    }

    const updated = await this.homework.findOneOrFail({
      where: { id: homework.id },
      relations: {
        attachments: true,
        subject: { yearLevel: true },
        term: { academicYear: true, yearLevel: true },
        createdBy: true,
      },
    });

    return { homework: await this.toHomeworkDto(updated) };
  }

  async delete(userId: string, role: UserRole, homeworkId: string) {
    const homework = await this.homework.findOne({
      where: { id: homeworkId },
      relations: { attachments: true },
    });
    if (!homework) {
      throw new AppError(404, "Homework not found", "NOT_FOUND");
    }

    if (role === UserRole.STAFF && homework.createdById !== userId) {
      await this.assertSubjectAccess(userId, role, homework.subjectId);
    }

    for (const att of homework.attachments ?? []) {
      await deleteObject(att.storageKey);
    }

    await this.homework.remove(homework);
    return { ok: true };
  }

  async getAttachment(
    userId: string,
    role: UserRole,
    homeworkId: string,
    attachmentId: string,
  ) {
    const homework = await this.homework.findOne({
      where: { id: homeworkId },
    });
    if (!homework) {
      throw new AppError(404, "Homework not found", "NOT_FOUND");
    }

    if (role === UserRole.STAFF && homework.createdById !== userId) {
      await this.assertSubjectAccess(userId, role, homework.subjectId);
    }

    const attachment = await this.attachments.findOne({
      where: { id: attachmentId, homeworkId },
    });
    if (!attachment) {
      throw new AppError(404, "Attachment not found", "ATTACHMENT_NOT_FOUND");
    }

    return {
      ...attachment,
      buffer: await getObjectBuffer(attachment.storageKey),
    };
  }

  async listSubmissions(
    userId: string,
    role: UserRole,
    homeworkId: string,
    filters: {
      page?: number;
      limit?: number;
      search?: string;
      status?: string;
    } = {},
  ) {
    const homework = await this.homework.findOne({
      where: { id: homeworkId },
      relations: {
        subject: true,
        term: { academicYear: true, yearLevel: true },
        attachments: true,
      },
    });
    if (!homework) {
      throw new AppError(404, "Homework not found", "NOT_FOUND");
    }

    if (role === UserRole.STAFF && homework.createdById !== userId) {
      await this.assertSubjectAccess(userId, role, homework.subjectId);
    }

    const assignedStudents = await this.assignees.find({
      where: { homeworkId },
      relations: { student: true },
      order: { createdAt: "ASC" },
    });

    const submissions = await this.submissions.find({
      where: { homeworkId },
      relations: { files: true, markedBy: true },
    });

    const submissionMap = new Map<string, HomeworkSubmission>();
    for (const sub of submissions) {
      submissionMap.set(sub.studentId, sub);
    }

    const allStudentList = assignedStudents.map((assignee) => {
      const studentUser = assignee.student;
      const sub = submissionMap.get(assignee.studentId) ?? null;

      return {
        studentId: assignee.studentId,
        student: {
          id: studentUser?.id ?? assignee.studentId,
          fullName: studentUser?.fullName ?? "Unknown Student",
          preferredName: studentUser?.preferredName ?? null,
          email: studentUser?.email ?? null,
        },
        submission: sub
          ? {
              id: sub.id,
              status: sub.status,
              submittedAt: sub.submittedAt ? sub.submittedAt.toISOString() : null,
              studentNotes: sub.studentNotes ?? null,
              marks: sub.marks != null ? Number(sub.marks) : null,
              maxMarks:
                sub.maxMarks != null
                  ? Number(sub.maxMarks)
                  : homework.maxMarks != null
                    ? Number(homework.maxMarks)
                    : 100,
              feedback: sub.feedback,
              isCompleted: Boolean(sub.isCompleted),
              markedAt: sub.markedAt ? sub.markedAt.toISOString() : null,
              markedBy: sub.markedBy
                ? {
                    id: sub.markedBy.id,
                    fullName:
                      sub.markedBy.preferredName ||
                      sub.markedBy.fullName ||
                      sub.markedBy.email,
                  }
                : null,
              files: (sub.files ?? []).map((file) => ({
                id: file.id,
                originalName: file.originalName,
                mimeType: file.mimeType,
                byteSize: file.byteSize,
                createdAt: file.createdAt.toISOString(),
              })),
            }
          : null,
      };
    });

    const totalStudents = allStudentList.length;
    const submittedCount = allStudentList.filter(
      (s) => s.submission && s.submission.status === "SUBMITTED",
    ).length;
    const completedCount = allStudentList.filter(
      (s) => s.submission && s.submission.isCompleted,
    ).length;

    // Apply Search Filter
    let filteredStudents = allStudentList;
    if (filters.search && filters.search.trim()) {
      const q = filters.search.trim().toLowerCase();
      filteredStudents = filteredStudents.filter((item) => {
        const name = (item.student.fullName || "").toLowerCase();
        const pref = (item.student.preferredName || "").toLowerCase();
        const email = (item.student.email || "").toLowerCase();
        return name.includes(q) || pref.includes(q) || email.includes(q);
      });
    }

    // Apply Status Filter if specified
    if (filters.status && filters.status.trim()) {
      const st = filters.status.trim().toUpperCase();
      if (st === "SUBMITTED") {
        filteredStudents = filteredStudents.filter(
          (s) => s.submission && s.submission.status === "SUBMITTED",
        );
      } else if (st === "PENDING") {
        filteredStudents = filteredStudents.filter(
          (s) => !s.submission || s.submission.status !== "SUBMITTED",
        );
      } else if (st === "COMPLETED") {
        filteredStudents = filteredStudents.filter(
          (s) => s.submission && s.submission.isCompleted,
        );
      }
    }

    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 10));
    const total = filteredStudents.length;
    const skip = (page - 1) * limit;
    const pagedStudents = filteredStudents.slice(skip, skip + limit);

    return {
      homework: {
        id: homework.id,
        title: homework.title,
        description: homework.description,
        dueDate: homework.dueDate,
        maxMarks: homework.maxMarks != null ? Number(homework.maxMarks) : 100,
        yearGroup: homework.yearGroup,
        subject: homework.subject ? toSubjectDto(homework.subject) : null,
        term: homework.term ? toTermDto(homework.term) : null,
        attachments: (homework.attachments ?? []).map(toAttachmentDto),
      },
      stats: {
        totalStudents,
        submittedCount,
        pendingCount: Math.max(0, totalStudents - submittedCount),
        completedCount,
      },
      students: pagedStudents,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async getSubmissionFile(
    userId: string,
    role: UserRole,
    homeworkId: string,
    submissionId: string,
    fileId: string,
  ) {
    const homework = await this.homework.findOne({
      where: { id: homeworkId },
    });
    if (!homework) {
      throw new AppError(404, "Homework not found", "NOT_FOUND");
    }

    if (role === UserRole.STAFF && homework.createdById !== userId) {
      await this.assertSubjectAccess(userId, role, homework.subjectId);
    }

    const submission = await this.submissions.findOne({
      where: { id: submissionId, homeworkId },
    });
    if (!submission) {
      throw new AppError(404, "Submission not found", "NOT_FOUND");
    }

    const file = await this.submissionFiles.findOne({
      where: { id: fileId, submissionId },
    });
    if (!file) {
      throw new AppError(404, "Submission file not found", "NOT_FOUND");
    }

    return {
      ...file,
      buffer: await getObjectBuffer(file.storageKey),
    };
  }

  async gradeSubmission(
    userId: string,
    role: UserRole,
    homeworkId: string,
    studentId: string,
    input: {
      marks?: number | null;
      maxMarks?: number | null;
      feedback?: string | null;
      isCompleted?: boolean;
    },
  ) {
    const homework = await this.homework.findOne({
      where: { id: homeworkId },
    });
    if (!homework) {
      throw new AppError(404, "Homework not found", "NOT_FOUND");
    }

    if (role === UserRole.STAFF && homework.createdById !== userId) {
      await this.assertSubjectAccess(userId, role, homework.subjectId);
    }

    const assignee = await this.assignees.findOne({
      where: { homeworkId, studentId },
    });
    if (!assignee) {
      throw new AppError(404, "Student is not assigned to this homework", "NOT_ASSIGNED");
    }

    let submission = await this.submissions.findOne({
      where: { homeworkId, studentId },
      relations: { files: true, markedBy: true },
    });

    if (!submission) {
      submission = this.submissions.create({
        homeworkId,
        studentId,
        status: "DRAFT",
        submittedAt: null,
      });
    }

    if (input.marks !== undefined) {
      submission.marks = input.marks != null ? input.marks : null;
    }
    if (input.maxMarks !== undefined) {
      submission.maxMarks = input.maxMarks != null ? input.maxMarks : 100;
    }
    if (input.feedback !== undefined) {
      submission.feedback = input.feedback ? input.feedback.trim() : null;
    }
    if (input.isCompleted !== undefined) {
      submission.isCompleted = Boolean(input.isCompleted);
    }
    submission.markedAt = new Date();
    submission.markedById = userId;

    await this.submissions.save(submission);

    const updated = await this.submissions.findOne({
      where: { id: submission.id },
      relations: { files: true, markedBy: true },
    });

    return {
      id: updated!.id,
      status: updated!.status,
      submittedAt: updated!.submittedAt ? updated!.submittedAt.toISOString() : null,
      studentNotes: updated!.studentNotes ?? null,
      marks: updated!.marks != null ? Number(updated!.marks) : null,
      maxMarks: updated!.maxMarks != null ? Number(updated!.maxMarks) : 100,
      feedback: updated!.feedback,
      isCompleted: Boolean(updated!.isCompleted),
      markedAt: updated!.markedAt ? updated!.markedAt.toISOString() : null,
      markedBy: updated!.markedBy
        ? {
            id: updated!.markedBy.id,
            fullName:
              updated!.markedBy.preferredName ||
              updated!.markedBy.fullName ||
              updated!.markedBy.email,
          }
        : null,
      files: (updated!.files ?? []).map((file) => ({
        id: file.id,
        originalName: file.originalName,
        mimeType: file.mimeType,
        byteSize: file.byteSize,
        createdAt: file.createdAt.toISOString(),
      })),
    };
  }

  private async assertSubjectAccess(
    userId: string,
    role: UserRole,
    subjectId: string,
  ) {
    if (role !== UserRole.STAFF) return;
    const allowed = await this.teacherSubjects.findOne({
      where: { teacherId: userId, subjectId },
    });
    if (!allowed) {
      throw new AppError(
        403,
        "You are not assigned to this subject",
        "FORBIDDEN",
      );
    }
  }

  private async resolveStudentIds(term: Term, subjectId: string) {
    const termYear = termYearLevelNumber(term);
    const enrollments = await this.enrollments.find({
      where: {
        termId: term.id,
        status: In([EnrollmentStatus.ACTIVE]),
      },
      relations: {
        student: true,
        subjects: { subject: true },
      },
    });

    const studentIds = new Set<string>();
    for (const enrollment of enrollments) {
      const hasSubject = (enrollment.subjects ?? []).some(
        (row) => row.subjectId === subjectId,
      );
      if (!hasSubject) continue;
      if (
        !yearLevelsCompatible(enrollment.student?.yearLevel ?? null, termYear)
      ) {
        continue;
      }
      if (enrollment.student?.userId) {
        studentIds.add(enrollment.student.userId);
      }
    }
    return [...studentIds];
  }

  private async storeAttachments(
    homeworkId: string,
    userId: string,
    uploads: UploadedHomeworkAttachment[],
  ) {
    for (const upload of uploads) {
      const attachment = await this.attachments.save(
        this.attachments.create({
          homeworkId,
          uploadedById: userId,
          storageKey: "pending",
          originalName: upload.originalName,
          mimeType: upload.mimeType,
          byteSize: upload.size,
        }),
      );
      const key = buildHomeworkAttachmentKey({
        homeworkId,
        attachmentId: attachment.id,
        fileName: upload.originalName,
      });
      try {
        await putObject({
          key,
          body: upload.buffer,
          contentType: upload.mimeType,
        });
        attachment.storageKey = key;
        await this.attachments.save(attachment);
      } catch (error) {
        await deleteObject(key);
        await this.attachments.remove(attachment);
        throw error;
      }
    }
  }

  private async toHomeworkDto(homework: Homework) {
    const assignedCount = await this.assignees.count({
      where: { homeworkId: homework.id },
    });

    const submittedCount = await this.submissions.count({
      where: { homeworkId: homework.id, status: "SUBMITTED" },
    });

    const pendingCount = Math.max(0, assignedCount - submittedCount);

    return {
      id: homework.id,
      title: homework.title,
      description: homework.description,
      dueDate: homework.dueDate,
      maxMarks: homework.maxMarks != null ? Number(homework.maxMarks) : 100,
      term: homework.term ? toTermDto(homework.term) : null,
      subject: homework.subject ? toSubjectDto(homework.subject) : null,
      yearGroup: homework.yearGroup,
      teacher: homework.createdBy
        ? {
            id: homework.createdBy.id,
            fullName: homework.createdBy.fullName,
            email: homework.createdBy.email,
          }
        : null,
      assignedCount,
      submittedCount,
      pendingCount,
      attachments: (homework.attachments ?? []).map(toAttachmentDto),
      createdAt: homework.createdAt.toISOString(),
      updatedAt: homework.updatedAt.toISOString(),
    };
  }
}

export const teacherHomeworkService = new TeacherHomeworkService();
