import { AppDataSource } from "../../../config/data-source.js";
import { AppError } from "../../../common/errors/AppError.js";
import { changedFields, writeAuditLog } from "../../../common/utils/audit-log.js";
import {
  buildSyllabusDocumentKey,
  deleteObject,
  storeUploadedObject,
  type IncomingStoredFile,
} from "../../../common/storage/object-storage.js";
import {
  AcademicYear,
  Subject,
  Syllabus,
  SyllabusDocument,
  SyllabusSkill,
  Term,
  YearLevel,
} from "../../../entities/index.js";

export type SyllabusSkillInput = {
  name: string;
  weightage?: number | null;
  description?: string | null;
};

type SyllabusRelations = {
  subject: { yearLevel: true };
  academicYear: true;
  yearLevel: true;
  term: true;
  documents: true;
  skills: true;
};

function toYearLevelDto(yearLevel: YearLevel) {
  return {
    id: yearLevel.id,
    name: yearLevel.name,
    sequence: yearLevel.sequence,
  };
}

function toSubjectDto(subject: Subject) {
  return {
    id: subject.id,
    name: subject.name,
    yearLevel: subject.yearLevel ? toYearLevelDto(subject.yearLevel) : null,
  };
}

function toDocumentDto(document: SyllabusDocument) {
  return {
    id: document.id,
    originalName: document.originalName,
    mimeType: document.mimeType,
    byteSize: document.byteSize,
    createdAt: document.createdAt.toISOString(),
  };
}

function toSkillDto(skill: SyllabusSkill) {
  return {
    id: skill.id,
    name: skill.name,
    weightage: skill.weightage != null ? Number(skill.weightage) : null,
    description: skill.description,
    sortOrder: skill.sortOrder,
  };
}

function toTermDto(term: Term | null | undefined) {
  if (!term) return null;
  return {
    id: term.id,
    name: term.name,
    startDate: term.startDate,
    endDate: term.endDate,
  };
}

function toSyllabusDto(syllabus: Syllabus) {
  const skills = [...(syllabus.skills ?? [])].sort(
    (left, right) => left.sortOrder - right.sortOrder,
  );
  return {
    id: syllabus.id,
    title: syllabus.title,
    overview: syllabus.overview,
    subject: toSubjectDto(syllabus.subject),
    academicYear: {
      id: syllabus.academicYear.id,
      year: syllabus.academicYear.year,
      displayName: syllabus.academicYear.displayName,
    },
    yearLevel: toYearLevelDto(syllabus.yearLevel),
    term: toTermDto(syllabus.term),
    appliesToAllTerms: syllabus.appliesToAllTerms,
    skills: skills.map(toSkillDto),
    documents: (syllabus.documents ?? []).map(toDocumentDto),
    createdAt: syllabus.createdAt.toISOString(),
    updatedAt: syllabus.updatedAt.toISOString(),
  };
}

function syllabusSnapshot(syllabus: Syllabus) {
  const skills = [...(syllabus.skills ?? [])]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((skill) => ({
      name: skill.name,
      weightage: skill.weightage != null ? Number(skill.weightage) : null,
      description: skill.description,
    }));
  return {
    title: syllabus.title,
    subject: syllabus.subject?.name ?? null,
    academicYear: syllabus.academicYear?.year ?? null,
    yearLevel: syllabus.yearLevel?.name ?? null,
    term: syllabus.appliesToAllTerms
      ? "All terms"
      : syllabus.term?.name ?? null,
    overview: syllabus.overview,
    skills,
  };
}

const syllabusRelations: SyllabusRelations = {
  subject: { yearLevel: true },
  academicYear: true,
  yearLevel: true,
  term: true,
  documents: true,
  skills: true,
};

export class AdminSyllabusService {
  private readonly syllabi = AppDataSource.getRepository(Syllabus);
  private readonly documents = AppDataSource.getRepository(SyllabusDocument);
  private readonly skills = AppDataSource.getRepository(SyllabusSkill);
  private readonly subjects = AppDataSource.getRepository(Subject);
  private readonly academicYears = AppDataSource.getRepository(AcademicYear);
  private readonly yearLevels = AppDataSource.getRepository(YearLevel);
  private readonly terms = AppDataSource.getRepository(Term);

  async list(filters?: {
    page?: number;
    limit?: number;
    search?: string;
    subjectId?: string;
    academicYearId?: string;
    yearLevelId?: string;
    termId?: string;
    allTerms?: boolean;
  }) {
    const page = Math.max(1, Number(filters?.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(filters?.limit) || 25));
    const search = (filters?.search ?? "").trim();

    const query = this.syllabi
      .createQueryBuilder("syllabus")
      .leftJoinAndSelect("syllabus.subject", "subject")
      .leftJoinAndSelect("subject.yearLevel", "subjectYearLevel")
      .leftJoinAndSelect("syllabus.academicYear", "academicYear")
      .leftJoinAndSelect("syllabus.yearLevel", "yearLevel")
      .leftJoinAndSelect("syllabus.term", "term")
      .leftJoinAndSelect("syllabus.documents", "documents")
      .leftJoinAndSelect("syllabus.skills", "skills")
      .orderBy("academicYear.year", "DESC")
      .addOrderBy("yearLevel.sequence", "ASC")
      .addOrderBy("subject.name", "ASC");

    if (filters?.subjectId) {
      query.andWhere("syllabus.subjectId = :subjectId", {
        subjectId: filters.subjectId,
      });
    }
    if (filters?.academicYearId) {
      query.andWhere("syllabus.academicYearId = :academicYearId", {
        academicYearId: filters.academicYearId,
      });
    }
    if (filters?.yearLevelId) {
      query.andWhere("syllabus.yearLevelId = :yearLevelId", {
        yearLevelId: filters.yearLevelId,
      });
    }
    if (filters?.allTerms) {
      query.andWhere("syllabus.appliesToAllTerms = true");
    } else if (filters?.termId) {
      query.andWhere("syllabus.termId = :termId", {
        termId: filters.termId,
      });
    }

    if (search) {
      query.andWhere(
        `(subject.name ILIKE :search
          OR syllabus.title ILIKE :search
          OR syllabus.overview ILIKE :search
          OR skills.name ILIKE :search
          OR skills.description ILIKE :search)`,
        { search: `%${search}%` },
      );
    }

    const [rows, total] = await query
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      syllabi: rows.map(toSyllabusDto),
      total,
      page,
      limit,
    };
  }

  async getById(id: string) {
    const syllabus = await this.findSyllabusOrThrow(id);
    return toSyllabusDto(syllabus);
  }

  async create(
    input: {
      subjectId: string;
      academicYearId: string;
      yearLevelId: string;
      termId?: string | null;
      appliesToAllTerms?: boolean;
      title: string;
      overview?: string | null;
      skills?: SyllabusSkillInput[];
    },
    actorId?: string,
  ) {
    const { subject, academicYear, yearLevel, term, appliesToAllTerms } =
      await this.resolveScope(input);

    await this.assertSlotAvailable({
      subjectId: subject.id,
      academicYearId: academicYear.id,
      yearLevelId: yearLevel.id,
      termId: term?.id ?? null,
      appliesToAllTerms,
    });

    const syllabus = this.syllabi.create({
      subject,
      academicYear,
      yearLevel,
      term,
      termId: term?.id ?? null,
      appliesToAllTerms,
      title: input.title.trim(),
      overview: input.overview?.trim() || null,
    });
    await this.syllabi.save(syllabus);
    await this.replaceSkills(syllabus.id, input.skills ?? []);

    const saved = await this.findSyllabusOrThrow(syllabus.id);
    const dto = toSyllabusDto(saved);
    await writeAuditLog({
      actorUserId: actorId,
      action: "CREATED",
      recordType: "syllabus",
      recordId: dto.id,
      recordLabel: dto.title,
      after: syllabusSnapshot(saved),
    });
    return dto;
  }

  async update(
    id: string,
    input: {
      subjectId?: string;
      academicYearId?: string;
      yearLevelId?: string;
      termId?: string | null;
      appliesToAllTerms?: boolean;
      title?: string;
      overview?: string | null;
      skills?: SyllabusSkillInput[];
    },
    actorId?: string,
  ) {
    const syllabus = await this.findSyllabusOrThrow(id);
    const before = syllabusSnapshot(syllabus);

    const scope = await this.resolveScope({
      subjectId: input.subjectId ?? syllabus.subjectId,
      academicYearId: input.academicYearId ?? syllabus.academicYearId,
      yearLevelId: input.yearLevelId ?? syllabus.yearLevelId,
      termId:
        input.termId !== undefined ? input.termId : syllabus.termId,
      appliesToAllTerms:
        input.appliesToAllTerms !== undefined
          ? input.appliesToAllTerms
          : syllabus.appliesToAllTerms,
      title: syllabus.title,
    });

    await this.assertSlotAvailable(
      {
        subjectId: scope.subject.id,
        academicYearId: scope.academicYear.id,
        yearLevelId: scope.yearLevel.id,
        termId: scope.term?.id ?? null,
        appliesToAllTerms: scope.appliesToAllTerms,
      },
      id,
    );

    syllabus.subject = scope.subject;
    syllabus.academicYear = scope.academicYear;
    syllabus.yearLevel = scope.yearLevel;
    syllabus.term = scope.term;
    syllabus.termId = scope.term?.id ?? null;
    syllabus.appliesToAllTerms = scope.appliesToAllTerms;
    if (input.title !== undefined) syllabus.title = input.title.trim();
    if (input.overview !== undefined) {
      syllabus.overview = input.overview?.trim() || null;
    }

    await this.syllabi.save(syllabus);
    if (input.skills !== undefined) {
      await this.replaceSkills(syllabus.id, input.skills);
    }

    const saved = await this.findSyllabusOrThrow(syllabus.id);
    const dto = toSyllabusDto(saved);
    const diff = changedFields(before, syllabusSnapshot(saved));
    await writeAuditLog({
      actorUserId: actorId,
      action: "EDITED",
      recordType: "syllabus",
      recordId: dto.id,
      recordLabel: dto.title,
      before: diff.before ?? before,
      after: diff.after ?? syllabusSnapshot(saved),
    });
    return dto;
  }

  async remove(id: string, actorId?: string) {
    const syllabus = await this.findSyllabusOrThrow(id);
    const before = syllabusSnapshot(syllabus);

    for (const document of syllabus.documents ?? []) {
      await deleteObject(document.storageKey).catch(() => undefined);
    }

    await this.syllabi.remove(syllabus);
    await writeAuditLog({
      actorUserId: actorId,
      action: "DELETED",
      recordType: "syllabus",
      recordId: id,
      recordLabel: before.title ?? "Syllabus",
      before,
    });
  }

  async addDocuments(
    syllabusId: string,
    files: IncomingStoredFile[],
    actorId?: string,
  ) {
    if (!files.length) {
      throw new AppError(400, "At least one file is required", "VALIDATION_ERROR");
    }

    const syllabus = await this.findSyllabusOrThrow(syllabusId);

    for (const file of files) {
      const document = this.documents.create({
        syllabus,
        syllabusId: syllabus.id,
        uploadedById: actorId ?? null,
        storageKey: "",
        originalName: file.originalName,
        mimeType: file.mimeType || "application/octet-stream",
        byteSize: file.size,
      });
      await this.documents.save(document);

      const key = buildSyllabusDocumentKey({
        syllabusId: syllabus.id,
        documentId: document.id,
        fileName: file.originalName,
      });

      try {
        await storeUploadedObject({
          finalKey: key,
          contentType: document.mimeType,
          buffer: file.buffer,
          directStorageKey: file.directStorageKey,
          byteSize: file.size,
        });
        document.storageKey = key;
        await this.documents.save(document);
      } catch (error) {
        await this.documents.remove(document);
        throw error;
      }
    }

    const saved = await this.findSyllabusOrThrow(syllabusId);
    return toSyllabusDto(saved);
  }

  async removeDocument(syllabusId: string, documentId: string, actorId?: string) {
    const document = await this.documents.findOne({
      where: { id: documentId, syllabusId },
    });
    if (!document) {
      throw new AppError(404, "Document not found", "SYLLABUS_DOCUMENT_NOT_FOUND");
    }

    await deleteObject(document.storageKey).catch(() => undefined);
    await this.documents.remove(document);

    await writeAuditLog({
      actorUserId: actorId,
      action: "DELETED",
      recordType: "syllabus_document",
      recordId: document.id,
      recordLabel: document.originalName,
      before: { syllabusId, originalName: document.originalName },
    });
  }

  async getDocumentFile(syllabusId: string, documentId: string) {
    const document = await this.documents.findOne({
      where: { id: documentId, syllabusId },
    });
    if (!document) {
      throw new AppError(404, "Document not found", "SYLLABUS_DOCUMENT_NOT_FOUND");
    }

    return {
      storageKey: document.storageKey,
      mimeType: document.mimeType,
      originalName: document.originalName,
    };
  }

  private async resolveScope(input: {
    subjectId: string;
    academicYearId: string;
    yearLevelId: string;
    termId?: string | null;
    appliesToAllTerms?: boolean;
    title?: string;
  }) {
    const subject = await this.subjects.findOne({
      where: { id: input.subjectId },
      relations: { yearLevel: true },
    });
    if (!subject) {
      throw new AppError(404, "Subject not found", "SUBJECT_NOT_FOUND");
    }

    const academicYear = await this.academicYears.findOne({
      where: { id: input.academicYearId },
    });
    if (!academicYear) {
      throw new AppError(404, "Academic year not found", "ACADEMIC_YEAR_NOT_FOUND");
    }

    const yearLevel = await this.yearLevels.findOne({
      where: { id: input.yearLevelId },
    });
    if (!yearLevel) {
      throw new AppError(404, "Year level not found", "YEAR_LEVEL_NOT_FOUND");
    }

    if (subject.yearLevel && subject.yearLevel.id !== yearLevel.id) {
      throw new AppError(
        400,
        "Selected subject does not match the chosen year level",
        "SUBJECT_YEAR_LEVEL_MISMATCH",
      );
    }

    const appliesToAllTerms = false;
    let term: Term | null = null;

    if (!input.termId) {
      throw new AppError(400, "Term is required", "VALIDATION_ERROR");
    }

    term = await this.terms.findOne({
      where: { id: input.termId },
      relations: { academicYear: true, yearLevel: true },
    });
    if (!term) {
      throw new AppError(404, "Term not found", "TERM_NOT_FOUND");
    }
    if (term.academicYear?.id && term.academicYear.id !== academicYear.id) {
      throw new AppError(
        400,
        "Selected term does not match the chosen academic year",
        "TERM_ACADEMIC_YEAR_MISMATCH",
      );
    }
    if (term.yearLevel?.id && term.yearLevel.id !== yearLevel.id) {
      throw new AppError(
        400,
        "Selected term does not match the chosen year level",
        "TERM_YEAR_LEVEL_MISMATCH",
      );
    }

    return { subject, academicYear, yearLevel, term, appliesToAllTerms };
  }

  private validateSkills(skills: SyllabusSkillInput[]) {
    const names = new Set<string>();
    for (const skill of skills) {
      const name = skill.name.trim();
      if (!name) {
        throw new AppError(400, "Each skill needs a name", "VALIDATION_ERROR");
      }
      const key = name.toLowerCase();
      if (names.has(key)) {
        throw new AppError(400, "Skill names must be unique", "VALIDATION_ERROR");
      }
      names.add(key);
      if (skill.weightage != null) {
        if (!Number.isFinite(skill.weightage) || skill.weightage < 0) {
          throw new AppError(
            400,
            "Skill weightage must be zero or greater",
            "VALIDATION_ERROR",
          );
        }
      }
    }
  }

  private async replaceSkills(syllabusId: string, skills: SyllabusSkillInput[]) {
    this.validateSkills(skills);
    await this.skills.delete({ syllabusId });
    if (skills.length === 0) return;

    const rows = skills.map((skill, index) =>
      this.skills.create({
        syllabusId,
        name: skill.name.trim(),
        weightage:
          skill.weightage != null && skill.weightage !== undefined
            ? String(skill.weightage)
            : null,
        description: skill.description?.trim() || null,
        sortOrder: index,
      }),
    );
    await this.skills.save(rows);
  }

  private async assertSlotAvailable(
    slot: {
      subjectId: string;
      academicYearId: string;
      yearLevelId: string;
      termId: string | null;
      appliesToAllTerms: boolean;
    },
    excludeId?: string,
  ) {
    const query = this.syllabi
      .createQueryBuilder("syllabus")
      .where("syllabus.subjectId = :subjectId", { subjectId: slot.subjectId })
      .andWhere("syllabus.academicYearId = :academicYearId", {
        academicYearId: slot.academicYearId,
      })
      .andWhere("syllabus.yearLevelId = :yearLevelId", {
        yearLevelId: slot.yearLevelId,
      });

    if (slot.appliesToAllTerms) {
      query.andWhere("syllabus.appliesToAllTerms = true");
    } else {
      query.andWhere("syllabus.termId = :termId", { termId: slot.termId });
    }

    if (excludeId) {
      query.andWhere("syllabus.id != :excludeId", { excludeId });
    }

    const existing = await query.getOne();
    if (existing) {
      throw new AppError(
        409,
        "A syllabus already exists for this subject, year level, academic year, and term scope",
        "SYLLABUS_ALREADY_EXISTS",
      );
    }
  }

  private async findSyllabusOrThrow(id: string) {
    const syllabus = await this.syllabi.findOne({
      where: { id },
      relations: syllabusRelations,
      order: {
        documents: { createdAt: "ASC" },
        skills: { sortOrder: "ASC" },
      },
    });
    if (!syllabus) {
      throw new AppError(404, "Syllabus not found", "SYLLABUS_NOT_FOUND");
    }
    return syllabus;
  }
}

export const adminSyllabusService = new AdminSyllabusService();
