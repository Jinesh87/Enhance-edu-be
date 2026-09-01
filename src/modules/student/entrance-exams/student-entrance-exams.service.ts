import { Brackets, In } from "typeorm";
import { AppDataSource } from "../../../config/data-source.js";
import { AppError } from "../../../common/errors/AppError.js";
import { EnrollmentStatus } from "../../../common/constants/enrollment.js";
import { AttendanceStatus } from "../../../entities/AttendanceRecord.js";
import {
  Assessment,
  AssessmentStudent,
  AssessmentSubmission,
  AssessmentSubmissionFile,
  AttendanceRecord,
  Class,
  ClassStudent,
  Enrollment,
  Session,
  Student,
} from "../../../entities/index.js";
import {
  buildAssessmentSubmissionKey,
  deleteObject,
  putObject,
} from "../../../common/storage/object-storage.js";
import { enqueueOcrJob } from "../../../common/queues/ocr-queue.js";
import {
  assertStudentAssessmentWindowOpen,
} from "../../admin/assessments/assessment-session-sync.service.js";

export type UploadedExamFile = {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  size: number;
};

function toSubmissionDto(
  submission: AssessmentSubmission,
  assessment?: Assessment | null,
) {
  return {
    id: submission.id,
    assessmentId: submission.assessmentId,
    studentId: submission.studentId,
    status: submission.status,
    submittedAt: submission.submittedAt?.toISOString() ?? null,
    extractedText: submission.extractedText,
    ocrError: submission.ocrError,
    files: (submission.files ?? [])
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((file) => ({
        id: file.id,
        originalName: file.originalName,
        mimeType: file.mimeType,
        byteSize: file.byteSize,
        sortOrder: file.sortOrder,
        hasExtractedText: Boolean(file.extractedText),
      })),
    assessment: assessment
      ? {
          id: assessment.id,
          name: assessment.name,
          subject: assessment.subject,
          yearGroup: assessment.yearGroup,
          termId: assessment.termId,
          termLabel: assessment.term?.name ?? "",
          assessmentDate: assessment.assessmentDate,
          startTime: assessment.startTime,
          durationMinutes: assessment.durationMinutes,
          kind: assessment.kind,
          scheduleType: assessment.scheduleType,
        }
      : null,
  };
}

class StudentEntranceExamsService {
  private readonly assessments = AppDataSource.getRepository(Assessment);
  private readonly assessmentStudents = AppDataSource.getRepository(AssessmentStudent);
  private readonly submissions = AppDataSource.getRepository(AssessmentSubmission);
  private readonly files = AppDataSource.getRepository(AssessmentSubmissionFile);
  private readonly students = AppDataSource.getRepository(Student);
  private readonly enrollments = AppDataSource.getRepository(Enrollment);
  private readonly classStudents = AppDataSource.getRepository(ClassStudent);
  private readonly classes = AppDataSource.getRepository(Class);
  private readonly sessions = AppDataSource.getRepository(Session);
  private readonly attendance = AppDataSource.getRepository(AttendanceRecord);

  private async requireStudent(userId: string) {
    const student = await this.students.findOne({ where: { userId } });
    if (!student) {
      throw new AppError(404, "Student record not found", "STUDENT_NOT_FOUND");
    }
    return student;
  }

  private async trialTermIdsForStudent(studentId: string): Promise<string[]> {
    const rows = await this.enrollments.find({
      where: {
        studentId,
        status: In([
          EnrollmentStatus.ACTIVE,
          EnrollmentStatus.AWAITING_GUARDIAN,
        ]),
      },
      relations: { term: true },
    });
    return rows
      .filter((row) => row.term?.isTrial)
      .map((row) => row.termId);
  }

  private async hasTrialAttendance(
    studentUserId: string,
    termId: string,
  ): Promise<boolean> {
    // Prefer enquiry flag when staff marked trial attended.
    try {
      const { Enquiry } = await import("../../../entities/index.js");
      const student = await this.students.findOne({
        where: { userId: studentUserId },
      });
      if (student) {
        const enrollments = await this.enrollments.find({
          where: { studentId: student.id, termId },
          relations: { guardian: true },
        });
        const emails = enrollments
          .map((row) => row.guardian?.email?.trim().toLowerCase())
          .filter((email): email is string => Boolean(email));
        if (emails.length > 0) {
          const enquiry = await AppDataSource.getRepository(Enquiry)
            .createQueryBuilder("enquiry")
            .where("LOWER(enquiry.guardianEmail) IN (:...emails)", { emails })
            .andWhere("enquiry.trialTermId = :termId", { termId })
            .andWhere("enquiry.trialAttended = true")
            .andWhere("enquiry.closedAt IS NULL")
            .getOne();
          if (enquiry) return true;
        }
      }
    } catch {
      /* fall through to attendance check */
    }

    const classes = await this.classes.find({
      where: { term: { id: termId } },
      select: { id: true },
    });
    if (classes.length === 0) return false;
    const classIds = classes.map((row) => row.id);

    const sessions = await this.sessions.find({
      where: { classId: In(classIds) },
      select: { id: true },
    });
    if (sessions.length === 0) return false;

    const attended = await this.attendance.findOne({
      where: {
        studentId: studentUserId,
        sessionId: In(sessions.map((s) => s.id)),
        status: In([AttendanceStatus.PRESENT, AttendanceStatus.LATE]),
      },
    });
    return Boolean(attended);
  }

  async listAvailable(studentUserId: string) {
    const student = await this.requireStudent(studentUserId);

    // 1. Directly assigned assessments
    const directRows = await this.assessmentStudents.find({
      where: { studentId: studentUserId },
      select: { assessmentId: true },
    });
    const directAssessmentIds = directRows.map((r) => r.assessmentId);

    // 2. Class enrolled assessments
    const classRows = await this.classStudents.find({
      where: { studentId: studentUserId },
      select: { classId: true },
    });
    const enrolledClassIds = classRows.map((r) => r.classId);

    // 3. Trial entrance exams
    const trialTermIds = await this.trialTermIdsForStudent(student.id);
    const eligibleTrialTermIds: string[] = [];
    for (const termId of trialTermIds) {
      if (await this.hasTrialAttendance(studentUserId, termId)) {
        eligibleTrialTermIds.push(termId);
      }
    }

    // 4. Enrollments (subjects & year levels)
    const enrollments = await this.enrollments.find({
      where: {
        studentId: student.id,
        status: In([
          EnrollmentStatus.ACTIVE,
          EnrollmentStatus.AWAITING_GUARDIAN,
        ]),
      },
      relations: {
        subjects: { subject: true },
        term: { academicYear: true, yearLevel: true },
      },
    });

    const enrolledTermIds = new Set<string>();
    const enrolledSubjects = new Set<string>();

    for (const enr of enrollments) {
      if (enr.termId) enrolledTermIds.add(enr.termId);
      for (const row of enr.subjects ?? []) {
        const name = row.subject?.name?.trim().toLowerCase();
        if (name) enrolledSubjects.add(name);
      }
    }

    const query = this.assessments
      .createQueryBuilder("assessment")
      .leftJoinAndSelect("assessment.term", "term")
      .leftJoinAndSelect("assessment.classroom", "classroom")
      .leftJoinAndSelect("assessment.teacher", "teacher")
      .where("assessment.status IN (:...statuses)", {
        statuses: ["SCHEDULED", "LIVE", "COMPLETED"],
      });

    query.andWhere(
      new Brackets((qb) => {
        let hasCondition = false;
        if (directAssessmentIds.length > 0) {
          qb.orWhere("assessment.id IN (:...directAssessmentIds)", {
            directAssessmentIds,
          });
          hasCondition = true;
        }
        if (enrolledClassIds.length > 0) {
          qb.orWhere("assessment.classId IN (:...enrolledClassIds)", {
            enrolledClassIds,
          });
          hasCondition = true;
        }
        if (eligibleTrialTermIds.length > 0) {
          qb.orWhere(
            "(assessment.kind = 'ENTRANCE' AND assessment.termId IN (:...eligibleTrialTermIds))",
            { eligibleTrialTermIds },
          );
          hasCondition = true;
        }
        if (enrolledTermIds.size > 0 && enrolledSubjects.size > 0) {
          qb.orWhere(
            "(assessment.termId IN (:...enrolledTermIds) AND LOWER(assessment.subject) IN (:...enrolledSubjects))",
            {
              enrolledTermIds: [...enrolledTermIds],
              enrolledSubjects: [...enrolledSubjects],
            },
          );
          hasCondition = true;
        }
        if (!hasCondition) {
          qb.where("1 = 0");
        }
      }),
    );

    query.orderBy("assessment.assessmentDate", "ASC").addOrderBy("assessment.startTime", "ASC");

    const exams = await query.getMany();

    const submissions =
      exams.length > 0
        ? await this.submissions.find({
            where: {
              studentId: studentUserId,
              assessmentId: In(exams.map((e) => e.id)),
            },
            relations: { files: true },
          })
        : [];

    const byAssessment = new Map(
      submissions.map((row) => [row.assessmentId, row]),
    );

    return {
      exams: exams.map((exam) => {
        const submission = byAssessment.get(exam.id) ?? null;
        return {
          id: exam.id,
          name: exam.name,
          kind: exam.kind,
          scheduleType: exam.scheduleType,
          subject: exam.subject,
          yearGroup: exam.yearGroup,
          termId: exam.termId,
          termLabel: exam.term?.name ?? "",
          assessmentDate: exam.assessmentDate,
          startTime: exam.startTime,
          durationMinutes: exam.durationMinutes,
          notes: exam.notes,
          submission: submission
            ? {
                id: submission.id,
                status: submission.status,
                submittedAt: submission.submittedAt?.toISOString() ?? null,
                fileCount: submission.files?.length ?? 0,
              }
            : null,
        };
      }),
    };
  }

  private async getOrCreateDraft(
    assessmentId: string,
    studentUserId: string,
  ): Promise<AssessmentSubmission> {
    const existing = await this.submissions.findOne({
      where: { assessmentId, studentId: studentUserId },
      relations: { files: true, assessment: { term: true } },
    });
    if (existing) {
      if (existing.status !== "DRAFT" && existing.submittedAt) {
        throw new AppError(
          400,
          "This exam has already been submitted",
          "ALREADY_SUBMITTED",
        );
      }
      return existing;
    }

    const created = this.submissions.create({
      assessmentId,
      studentId: studentUserId,
      status: "DRAFT",
      submittedAt: null,
      extractedText: null,
      ocrError: null,
    });
    return this.submissions.save(created);
  }

  private async assertCanAccessExam(
    studentUserId: string,
    assessmentId: string,
  ): Promise<Assessment> {
    return this.assertCanAccessAssessment(studentUserId, assessmentId);
  }

  private async assertCanAccessAssessment(
    studentUserId: string,
    assessmentId: string,
  ): Promise<Assessment> {
    const student = await this.requireStudent(studentUserId);
    const assessment = await this.assessments.findOne({
      where: { id: assessmentId },
      relations: { term: true },
    });
    if (
      !assessment ||
      assessment.status === "ARCHIVED" ||
      assessment.status === "CANCELLED"
    ) {
      throw new AppError(
        404,
        "Assessment not found",
        "ASSESSMENT_NOT_FOUND",
      );
    }

    // 1. Direct assessment assignment
    const sitting = await this.assessmentStudents.findOne({
      where: { assessmentId, studentId: studentUserId },
    });
    if (sitting) return assessment;

    // 2. Class enrollment
    if (assessment.classId) {
      const classEnrollment = await this.classStudents.findOne({
        where: { classId: assessment.classId, studentId: studentUserId },
      });
      if (classEnrollment) return assessment;
    }

    // 3. Trial entrance exam
    if (assessment.kind === "ENTRANCE") {
      const termIds = await this.trialTermIdsForStudent(student.id);
      if (
        termIds.includes(assessment.termId) &&
        (await this.hasTrialAttendance(studentUserId, assessment.termId))
      ) {
        return assessment;
      }
    }

    // 4. Term and active enrollment check
    const enrollment = await this.enrollments.findOne({
      where: {
        studentId: student.id,
        termId: assessment.termId,
        status: In([
          EnrollmentStatus.ACTIVE,
          EnrollmentStatus.AWAITING_GUARDIAN,
        ]),
      },
    });
    if (enrollment) return assessment;

    throw new AppError(
      403,
      "You are not enrolled in this assessment",
      "NOT_ENROLLED",
    );
  }

  async getSubmission(studentUserId: string, assessmentId: string) {
    const assessment = await this.assertCanAccessExam(
      studentUserId,
      assessmentId,
    );
    let submission = await this.submissions.findOne({
      where: { assessmentId, studentId: studentUserId },
      relations: { files: true },
    });
    if (!submission) {
      const created = this.submissions.create({
        assessmentId,
        studentId: studentUserId,
        status: "DRAFT",
        submittedAt: null,
        extractedText: null,
        ocrError: null,
      });
      await this.submissions.save(created);
      submission = await this.submissions.findOneOrFail({
        where: { id: created.id },
        relations: { files: true },
      });
    }
    return { submission: toSubmissionDto(submission, assessment) };
  }

  async getAssessmentSubmission(studentUserId: string, assessmentId: string) {
    const assessment = await this.assertCanAccessAssessment(
      studentUserId,
      assessmentId,
    );
    const submission = await this.getOrCreateDraft(
      assessmentId,
      studentUserId,
    );
    return { submission: toSubmissionDto(submission, assessment) };
  }

  async uploadFiles(
    studentUserId: string,
    assessmentId: string,
    uploads: UploadedExamFile[],
  ) {
    const assessment = await this.assertCanAccessExam(
      studentUserId,
      assessmentId,
    );
    return this.uploadFilesForAssessment(
      assessment,
      studentUserId,
      uploads,
    );
  }

  async uploadAssessmentFiles(
    studentUserId: string,
    assessmentId: string,
    uploads: UploadedExamFile[],
  ) {
    const assessment = await this.assertCanAccessAssessment(
      studentUserId,
      assessmentId,
    );
    return this.uploadFilesForAssessment(
      assessment,
      studentUserId,
      uploads,
    );
  }

  private async uploadFilesForAssessment(
    assessment: Assessment,
    studentUserId: string,
    uploads: UploadedExamFile[],
  ) {
    assertStudentAssessmentWindowOpen(assessment, "submission");
    if (uploads.length === 0) {
      throw new AppError(400, "Choose at least one file", "NO_FILES");
    }
    const submission = await this.getOrCreateDraft(assessment.id, studentUserId);
    if (submission.status !== "DRAFT") {
      throw new AppError(
        400,
        "Cannot add files after submit",
        "ALREADY_SUBMITTED",
      );
    }

    const existingCount = await this.files.count({
      where: { submissionId: submission.id },
    });
    if (existingCount + uploads.length > 30) {
      throw new AppError(400, "Too many files (max 30)", "TOO_MANY_FILES");
    }

    const savedFiles: AssessmentSubmissionFile[] = [];
    let order = existingCount;
    for (const upload of uploads) {
      const key = buildAssessmentSubmissionKey({
        assessmentId: assessment.id,
        studentId: studentUserId,
        submissionId: submission.id,
        fileName: upload.originalName,
      });
      await putObject({
        key,
        body: upload.buffer,
        contentType: upload.mimeType,
      });

      const row = await this.files.save(
        this.files.create({
          submissionId: submission.id,
          storageKey: key,
          originalName: upload.originalName,
          mimeType: upload.mimeType,
          byteSize: upload.size,
          sortOrder: order,
          extractedText: null,
        }),
      );
      order += 1;
      savedFiles.push(row);
    }

    const refreshed = await this.submissions.findOneOrFail({
      where: { id: submission.id },
      relations: { files: true },
    });
    return {
      submission: toSubmissionDto(refreshed, assessment),
      added: savedFiles.length,
    };
  }

  async removeFile(
    studentUserId: string,
    assessmentId: string,
    fileId: string,
  ) {
    const assessment = await this.assertCanAccessExam(studentUserId, assessmentId);
    assertStudentAssessmentWindowOpen(assessment, "submission");
    const submission = await this.submissions.findOne({
      where: { assessmentId, studentId: studentUserId },
    });
    if (!submission || submission.status !== "DRAFT") {
      throw new AppError(400, "Cannot remove files now", "NOT_EDITABLE");
    }
    const file = await this.files.findOne({
      where: { id: fileId, submissionId: submission.id },
    });
    if (!file) {
      throw new AppError(404, "File not found", "FILE_NOT_FOUND");
    }
    await deleteObject(file.storageKey);
    await this.files.remove(file);
    return { ok: true };
  }

  async removeAssessmentFile(
    studentUserId: string,
    assessmentId: string,
    fileId: string,
  ) {
    const assessment = await this.assertCanAccessAssessment(
      studentUserId,
      assessmentId,
    );
    assertStudentAssessmentWindowOpen(assessment, "submission");
    const submission = await this.submissions.findOne({
      where: { assessmentId, studentId: studentUserId },
    });
    if (!submission || submission.status !== "DRAFT") {
      throw new AppError(400, "Cannot remove files now", "NOT_EDITABLE");
    }
    const file = await this.files.findOne({
      where: { id: fileId, submissionId: submission.id },
    });
    if (!file) {
      throw new AppError(404, "File not found", "FILE_NOT_FOUND");
    }
    await deleteObject(file.storageKey);
    await this.files.remove(file);
    return { ok: true };
  }

  async submit(studentUserId: string, assessmentId: string) {
    const assessment = await this.assertCanAccessExam(
      studentUserId,
      assessmentId,
    );
    assertStudentAssessmentWindowOpen(assessment, "submission");
    const submission = await this.submissions.findOne({
      where: { assessmentId, studentId: studentUserId },
      relations: { files: true },
    });
    if (!submission) {
      throw new AppError(400, "Upload answers before submitting", "NO_SUBMISSION");
    }
    if (submission.status !== "DRAFT") {
      throw new AppError(400, "Already submitted", "ALREADY_SUBMITTED");
    }
    if (!submission.files?.length) {
      throw new AppError(400, "Upload at least one answer file", "NO_FILES");
    }

    submission.status = "SUBMITTED";
    submission.submittedAt = new Date();
    await this.submissions.save(submission);

    await this.markExamAttended(studentUserId, assessment.termId, assessment);

    await enqueueOcrJob(submission.id);

    const refreshed = await this.submissions.findOneOrFail({
      where: { id: submission.id },
      relations: { files: true },
    });
    return { submission: toSubmissionDto(refreshed, assessment) };
  }

  async submitAssessment(studentUserId: string, assessmentId: string) {
    const assessment = await this.assertCanAccessAssessment(
      studentUserId,
      assessmentId,
    );
    assertStudentAssessmentWindowOpen(assessment, "submission");
    const submission = await this.submissions.findOne({
      where: { assessmentId, studentId: studentUserId },
      relations: { files: true },
    });
    if (!submission) {
      throw new AppError(400, "Upload answers before submitting", "NO_SUBMISSION");
    }
    if (submission.status !== "DRAFT") {
      throw new AppError(400, "Already submitted", "ALREADY_SUBMITTED");
    }
    if (!submission.files?.length) {
      throw new AppError(400, "Upload at least one answer file", "NO_FILES");
    }

    submission.status = "SUBMITTED";
    submission.submittedAt = new Date();
    await this.submissions.save(submission);
    await enqueueOcrJob(submission.id);

    const refreshed = await this.submissions.findOneOrFail({
      where: { id: submission.id },
      relations: { files: true },
    });
    return { submission: toSubmissionDto(refreshed, assessment) };
  }

  private async markExamAttended(
    studentUserId: string,
    termId: string,
    assessment: Assessment,
  ) {
    try {
      const { adminEnquiriesService } = await import(
        "../../admin/enquiries/admin-enquiries.service.js"
      );
      await adminEnquiriesService.markExamAttendedForStudent(studentUserId, {
        termId,
        examSession: assessment.name,
        actorId: studentUserId,
      });
    } catch (error) {
      // Submission already saved; enquiry sync failure should not roll back upload.
      const { logger } = await import("../../../config/logger.js");
      logger.error(
        { error, studentUserId, termId },
        "Failed to mark entrance exam attended on enquiry",
      );
    }
  }
}

export const studentEntranceExamsService = new StudentEntranceExamsService();
