import { AppDataSource } from "../../../config/data-source.js";
import { ClassFeedback } from "../../../entities/index.js";

export type FeedbackQuery = {
  from?: string;
  to?: string;
  rating?: number;
  classId?: string;
};

type FeedbackRow = {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: Date;
  updatedAt: Date;
  sessionId: string;
  startAt: Date;
  endAt: Date;
  classId: string | null;
  className: string | null;
  subject: string | null;
  studentId: string;
  studentName: string;
  studentPreferred: string | null;
  guardianId: string;
  guardianName: string;
  guardianEmail: string | null;
  sessionTeacher: string | null;
  classTeacher: string | null;
};

function ymd(date: Date) {
  return date.toISOString().slice(0, 10);
}

function defaultPeriod() {
  const to = new Date();
  const from = new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000);
  return { from: ymd(from), to: ymd(to) };
}

class AdminFeedbackService {
  async list(query: FeedbackQuery) {
    const fallback = defaultPeriod();
    const from = query.from || fallback.from;
    const to = query.to || fallback.to;

    const qb = AppDataSource.getRepository(ClassFeedback)
      .createQueryBuilder("f")
      .innerJoin("f.session", "s")
      .leftJoin("s.class", "c")
      .leftJoin("s.teacher", "st")
      .leftJoin("c.teacher", "ct")
      .innerJoin("f.student", "stu")
      .innerJoin("f.guardian", "g")
      .select("f.id", "id")
      .addSelect("f.rating", "rating")
      .addSelect("f.comment", "comment")
      .addSelect("f.createdAt", "createdAt")
      .addSelect("f.updatedAt", "updatedAt")
      .addSelect("s.id", "sessionId")
      .addSelect("s.startAt", "startAt")
      .addSelect("s.endAt", "endAt")
      .addSelect("c.id", "classId")
      .addSelect("c.name", "className")
      .addSelect("c.subject", "subject")
      .addSelect("stu.id", "studentId")
      .addSelect("stu.fullName", "studentName")
      .addSelect("stu.preferredName", "studentPreferred")
      .addSelect("g.id", "guardianId")
      .addSelect("g.fullName", "guardianName")
      .addSelect("g.email", "guardianEmail")
      .addSelect("st.fullName", "sessionTeacher")
      .addSelect("ct.fullName", "classTeacher")
      .where("s.startAt >= CAST(:from AS date)", { from })
      .andWhere("s.startAt < CAST(:to AS date) + 1", { to });

    const inPeriod: FeedbackRow[] = await qb
      .orderBy("s.startAt", "DESC")
      .addOrderBy("f.createdAt", "DESC")
      .getRawMany();
    const all = query.classId
      ? inPeriod.filter((row) => row.classId === query.classId)
      : inPeriod;

    const distribution = [1, 2, 3, 4, 5].map((stars) => ({
      rating: stars,
      count: all.filter((row) => Number(row.rating) === stars).length,
    }));
    const total = all.length;
    const average = total
      ? Math.round((all.reduce((sum, row) => sum + Number(row.rating), 0) / total) * 100) / 100
      : 0;

    const classMap = new Map<string, { id: string; name: string; count: number; sum: number }>();
    for (const row of inPeriod) {
      if (!row.classId) continue;
      const entry = classMap.get(row.classId) ?? {
        id: row.classId,
        name: row.className ?? "Class",
        count: 0,
        sum: 0,
      };
      entry.count += 1;
      entry.sum += Number(row.rating);
      classMap.set(row.classId, entry);
    }

    const rows = query.rating ? all.filter((row) => Number(row.rating) === query.rating) : all;

    return {
      period: { from, to },
      summary: {
        total,
        average,
        withComments: all.filter((row) => row.comment && row.comment.trim()).length,
        lowRatings: all.filter((row) => Number(row.rating) <= 2).length,
        distribution,
      },
      classes: [...classMap.values()]
        .map((c) => ({
          id: c.id,
          name: c.name,
          count: c.count,
          average: Math.round((c.sum / c.count) * 100) / 100,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      items: rows.map((row) => ({
        id: row.id,
        rating: Number(row.rating),
        comment: row.comment,
        submittedAt: new Date(row.updatedAt).toISOString(),
        session: {
          id: row.sessionId,
          startAt: new Date(row.startAt).toISOString(),
          endAt: new Date(row.endAt).toISOString(),
        },
        class: row.classId
          ? { id: row.classId, name: row.className ?? "Class", subject: row.subject }
          : null,
        teacherName: row.sessionTeacher || row.classTeacher || null,
        student: { id: row.studentId, name: row.studentPreferred || row.studentName },
        guardian: { id: row.guardianId, name: row.guardianName, email: row.guardianEmail },
      })),
    };
  }
}

export const adminFeedbackService = new AdminFeedbackService();
