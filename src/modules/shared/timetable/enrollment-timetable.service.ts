import { In } from "typeorm";
import { AppDataSource } from "../../../config/data-source.js";
import { Subject, Term } from "../../../entities/index.js";
import { adminClassesService } from "../../admin/classes/admin-classes.service.js";
import { applySequentialLessonLabels } from "../../../common/utils/session-lesson-labels.js";
import type { EmailAttachment } from "../../email/email.service.js";
import {
  renderEnrollmentTimetablePdf,
  slugifyTimetableFilename,
  type TimetableSessionRow,
} from "./enrollment-timetable-pdf.js";

export type TimetableEnrollmentInput = {
  studentFullName: string;
  yearLevelName: string;
  termId: string;
  subjectIds: string[];
};

function buildClassTermLabel(term: Term) {
  return [
    term.name,
    term.academicYear?.year,
    term.yearLevel?.name,
  ]
    .filter(Boolean)
    .join(" · ");
}

export class EnrollmentTimetableService {
  private readonly terms = AppDataSource.getRepository(Term);
  private readonly subjects = AppDataSource.getRepository(Subject);

  async buildAttachments(
    enrollments: TimetableEnrollmentInput[],
  ): Promise<EmailAttachment[]> {
    const attachments: EmailAttachment[] = [];

    for (const row of enrollments) {
      if (!row.subjectIds.length) continue;

      const term = await this.terms.findOne({
        where: { id: row.termId },
        relations: { academicYear: true, yearLevel: true },
      });
      if (!term) continue;

      const subjects = await this.subjects.find({
        where: { id: In(row.subjectIds) },
      });
      if (subjects.length === 0) continue;

      const termLabel = buildClassTermLabel(term);
      const timetables = await Promise.all(
        subjects.map(async (subject) => {
          const data = await adminClassesService.listGroupSessions(
            subject.name,
            termLabel,
            { limit: 500, status: "ALL" },
          );
          return {
            subjectName: subject.name,
            sessions: applySequentialLessonLabels(
              data.sessions,
            ) as TimetableSessionRow[],
          };
        }),
      );

      const pdf = renderEnrollmentTimetablePdf({
        studentName: row.studentFullName,
        yearLevelName: row.yearLevelName,
        termLabel,
        term,
        timetables,
      });

      const slug = slugifyTimetableFilename(row.studentFullName || "student");
      attachments.push({
        filename: `timetable-${slug || "student"}.pdf`,
        content: pdf,
      });
    }

    return attachments;
  }
}

export const enrollmentTimetableService = new EnrollmentTimetableService();
