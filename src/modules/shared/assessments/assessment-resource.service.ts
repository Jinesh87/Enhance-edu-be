import { AppDataSource } from "../../../config/data-source.js";
import { AppError } from "../../../common/errors/AppError.js";
import {
  Assessment,
  AssessmentResource,
  AssessmentStudent,
} from "../../../entities/index.js";
import {
  buildAssessmentResourceKey,
  deleteObject,
  getObjectBuffer,
  putObject,
} from "../../../common/storage/object-storage.js";
import { UserRole } from "../../../common/constants/roles.js";

export type UploadedAssessmentResource = {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  size: number;
};

function toResourceDto(resource: AssessmentResource) {
  return {
    id: resource.id,
    assessmentId: resource.assessmentId,
    originalName: resource.originalName,
    mimeType: resource.mimeType,
    byteSize: resource.byteSize,
    createdAt: resource.createdAt.toISOString(),
  };
}

export class AssessmentResourceService {
  private readonly assessments = AppDataSource.getRepository(Assessment);
  private readonly resources = AppDataSource.getRepository(AssessmentResource);
  private readonly sitting = AppDataSource.getRepository(AssessmentStudent);

  private async requireAssessment(assessmentId: string) {
    const assessment = await this.assessments.findOne({
      where: { id: assessmentId },
      relations: { teacher: true },
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
    return assessment;
  }

  private async assertTeacherAccess(
    assessmentId: string,
    userId: string,
    role: UserRole,
  ) {
    const assessment = await this.requireAssessment(assessmentId);
    if (
      role !== UserRole.SUPER_ADMIN &&
      role !== UserRole.OFFICE_STAFF &&
      assessment.teacherId !== userId
    ) {
      throw new AppError(
        403,
        "You are not authorized to manage this assessment",
        "FORBIDDEN",
      );
    }
    return assessment;
  }

  private async assertStudentAccess(
    assessmentId: string,
    studentUserId: string,
  ) {
    const assessment = await this.requireAssessment(assessmentId);
    const allowed = await this.sitting.findOne({
      where: {
        assessmentId,
        studentId: studentUserId,
      },
    });
    if (!allowed) {
      throw new AppError(
        403,
        "You are not on this assessment roll",
        "NOT_ENROLLED",
      );
    }
    return assessment;
  }

  async listForAssessment(
    assessmentId: string,
    userId: string,
    role: UserRole,
  ) {
    await this.assertTeacherAccess(assessmentId, userId, role);
    const resources = await this.resources.find({
      where: { assessmentId },
      order: { createdAt: "ASC" },
    });
    return { resources: resources.map(toResourceDto) };
  }

  async uploadForAssessment(
    assessmentId: string,
    userId: string,
    role: UserRole,
    uploads: UploadedAssessmentResource[],
  ) {
    if (uploads.length === 0) {
      throw new AppError(400, "Choose at least one file", "NO_FILES");
    }
    await this.assertTeacherAccess(assessmentId, userId, role);
    if (uploads.length > 20) {
      throw new AppError(400, "Too many files (max 20)", "TOO_MANY_FILES");
    }

    const created: AssessmentResource[] = [];
    for (const upload of uploads) {
      const allowed =
        upload.mimeType.startsWith("image/") ||
        upload.mimeType === "application/pdf" ||
        upload.mimeType === "text/plain" ||
        upload.mimeType === "text/csv" ||
        upload.mimeType ===
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        upload.mimeType === "application/msword";
      if (!allowed) {
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

      const resource = await this.resources.save(
        this.resources.create({
          assessmentId,
          uploadedById: userId,
          storageKey: "pending",
          originalName: upload.originalName,
          mimeType: upload.mimeType,
          byteSize: upload.size,
        }),
      );
      const key = buildAssessmentResourceKey({
        assessmentId,
        resourceId: resource.id,
        fileName: upload.originalName,
      });
      try {
        await putObject({
          key,
          body: upload.buffer,
          contentType: upload.mimeType,
        });
        resource.storageKey = key;
        created.push(await this.resources.save(resource));
      } catch (error) {
        await deleteObject(key);
        await this.resources.remove(resource);
        throw error;
      }
    }

    return { resources: created.map(toResourceDto) };
  }

  async removeForAssessment(
    assessmentId: string,
    resourceId: string,
    userId: string,
    role: UserRole,
  ) {
    await this.assertTeacherAccess(assessmentId, userId, role);
    const resource = await this.resources.findOne({
      where: { id: resourceId, assessmentId },
    });
    if (!resource) {
      throw new AppError(404, "Resource not found", "RESOURCE_NOT_FOUND");
    }
    await deleteObject(resource.storageKey);
    await this.resources.remove(resource);
    return { ok: true };
  }

  async getForStudent(
    assessmentId: string,
    resourceId: string,
    studentUserId: string,
  ) {
    await this.assertStudentAccess(assessmentId, studentUserId);
    const resource = await this.resources.findOne({
      where: { id: resourceId, assessmentId },
    });
    if (!resource) {
      throw new AppError(404, "Resource not found", "RESOURCE_NOT_FOUND");
    }
    return {
      ...resource,
      buffer: await getObjectBuffer(resource.storageKey),
    };
  }

  async listForStudent(assessmentId: string, studentUserId: string) {
    await this.assertStudentAccess(assessmentId, studentUserId);
    const resources = await this.resources.find({
      where: { assessmentId },
      order: { createdAt: "ASC" },
    });
    return resources.map(toResourceDto);
  }
}

export const assessmentResourceService = new AssessmentResourceService();
