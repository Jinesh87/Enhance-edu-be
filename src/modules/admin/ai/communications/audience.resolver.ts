import { AppDataSource } from "../../../../config/data-source.js";
import { AppError } from "../../../../common/errors/AppError.js";
import { UserRole, UserStatus } from "../../../../common/constants/roles.js";
import type {
  CommunicationAudience,
  CommunicationRecipientSnapshot,
} from "../../../../entities/AdminAiCommunicationDraft.js";
import { dayBoundsInClassTz } from "../tool-helpers.js";
import {
  defaultAudienceStatus,
  describeAudience,
  normalizeGroup,
  type AudienceGroup,
} from "./audience.normalize.js";

export {
  describeAudience,
  expandLegacyType,
  isCommunicationAudienceType,
  normalizeAudienceType,
  normalizeGroup,
  normalizeRole,
  suggestAmbiguityOptions,
  AUDIENCE_GROUPS,
  AUDIENCE_ROLES,
} from "./audience.normalize.js";

type UserRow = {
  userId: string;
  name: string;
  hasEmail?: boolean;
  email?: string | null;
  role?: string | null;
  studentName?: string | null;
  relationshipLabel?: string | null;
};

const RECIPIENT_LIMIT = 500;

function dedupeRecipients(rows: UserRow[]): CommunicationRecipientSnapshot[] {
  const byUser = new Map<string, CommunicationRecipientSnapshot>();
  for (const row of rows) {
    const existing = byUser.get(row.userId);
    const studentName = row.studentName?.trim() || null;
    const relationship =
      row.relationshipLabel?.trim() ||
      (row.role?.toUpperCase() === UserRole.GUARDIAN ? "Guardian" : null);
    const hasEmail =
      typeof row.hasEmail === "boolean"
        ? row.hasEmail
        : Boolean(row.email?.trim());
    if (existing) {
      if (
        studentName &&
        !(existing.studentNames ?? []).includes(studentName)
      ) {
        existing.studentNames = [...(existing.studentNames ?? []), studentName];
      }
      if (hasEmail) existing.hasEmail = true;
      if (!existing.relationshipLabel && relationship) {
        existing.relationshipLabel = relationship;
      }
      continue;
    }
    byUser.set(row.userId, {
      userId: row.userId,
      name: row.name.trim() || "Recipient",
      hasEmail,
      role: row.role ?? null,
      studentNames: studentName ? [studentName] : [],
      relationshipLabel: relationship,
      selected: true,
      status: "pending",
      errorReason: null,
      providerMessageId: null,
    });
  }
  return [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function intersectByUserId(a: UserRow[], b: UserRow[]): UserRow[] {
  if (!a.length) return b;
  if (!b.length) return a;
  const ids = new Set(b.map((row) => row.userId));
  return a.filter((row) => ids.has(row.userId));
}

/**
 * Filter-first audience resolver.
 * Structured intent → permission-scoped DB queries → deduped recipients.
 * Add new groups by registering a handler — do not fork the send flow.
 */
export class AudienceResolverService {
  async resolve(
    audience: CommunicationAudience,
  ): Promise<CommunicationRecipientSnapshot[]> {
    if (audience.ambiguous && !audience.confirmed) {
      return [];
    }

    const groups = (audience.groups ?? [])
      .map((g) => normalizeGroup(g))
      .filter((g): g is AudienceGroup => Boolean(g));

    let rows: UserRow[] = [];

    if (groups.length) {
      rows = await this.resolveGroup(groups[0]!, audience);
      for (const group of groups.slice(1)) {
        rows = intersectByUserId(rows, await this.resolveGroup(group, audience));
      }
    } else if (audience.userIds?.length) {
      rows = await this.resolveUsersByIds(audience);
    } else {
      rows = await this.resolveByRolesAndAcademic(audience);
    }

    if (audience.userIds?.length && groups.length) {
      const allowed = new Set(audience.userIds);
      rows = rows.filter((row) => allowed.has(row.userId));
    }

    if ((audience.recipientOf ?? "SELF").toUpperCase() === "PARENTS") {
      rows = await this.guardiansForStudentUsers(rows.map((r) => r.userId));
    }

    return dedupeRecipients(rows).slice(0, RECIPIENT_LIMIT);
  }

  private async resolveGroup(
    group: AudienceGroup,
    audience: CommunicationAudience,
  ): Promise<UserRow[]> {
    switch (group) {
      case "OVERDUE_HOMEWORK":
        return this.overdueHomeworkStudents(audience);
      case "ABSENCES":
        return this.absenceStudents(audience);
      case "SESSION_TEACHERS":
        return this.sessionTeachers(audience);
      case "ASSESSMENT_PARTICIPANTS":
        return this.assessmentParticipants(audience);
      case "ENQUIRY_CONTACTS":
        return this.enquiryContacts(audience);
      case "CLASS_ROSTER":
        return this.classRosterStudents(audience);
      case "ENROLLED":
        return this.enrolledStudents(audience);
      default:
        throw new AppError(
          400,
          "That audience group is not available.",
          "ADMIN_AI_COMM_AUDIENCE_INVALID",
        );
    }
  }

  private async resolveByRolesAndAcademic(
    audience: CommunicationAudience,
  ): Promise<UserRow[]> {
    const roles = (audience.roles ?? [])
      .map((r) => r.trim().toUpperCase())
      .filter(Boolean);
    if (!roles.length && audience.nameQuery?.trim()) {
      return this.resolveUsersByName(audience);
    }
    if (!roles.length) {
      throw new AppError(
        400,
        "Provide roles, groups, or userIds to resolve recipients.",
        "ADMIN_AI_COMM_AUDIENCE_INVALID",
      );
    }

    if (roles.includes(UserRole.STUDENT)) {
      if (audience.className?.trim() || audience.subject?.trim()) {
        return this.classRosterStudents(audience);
      }
      if (
        audience.nameQuery?.trim() &&
        !audience.yearLevel?.trim() &&
        !audience.term?.trim()
      ) {
        return this.studentsByName(audience);
      }
      return this.enrolledStudents(audience);
    }
    if (roles.includes(UserRole.STAFF)) {
      return this.teachers(audience);
    }
    if (roles.includes(UserRole.OFFICE_STAFF)) {
      return this.officeStaff(audience);
    }
    if (roles.includes(UserRole.GUARDIAN)) {
      return this.guardians(audience);
    }
    if (roles.includes(UserRole.SUPER_ADMIN)) {
      return this.usersByRole(audience, UserRole.SUPER_ADMIN);
    }

    throw new AppError(
      400,
      "That audience role is not available.",
      "ADMIN_AI_COMM_AUDIENCE_INVALID",
    );
  }

  private async resolveUsersByIds(
    audience: CommunicationAudience,
  ): Promise<UserRow[]> {
    const ids = (audience.userIds ?? []).filter(Boolean).slice(0, RECIPIENT_LIMIT);
    if (!ids.length) {
      throw new AppError(
        400,
        "Provide at least one user id.",
        "ADMIN_AI_COMM_USER_IDS_REQUIRED",
      );
    }
    const status = defaultAudienceStatus(audience.status);
    const params: unknown[] = [ids, status];
    let nameFilter = "";
    if (audience.nameQuery?.trim()) {
      params.push(`%${audience.nameQuery.trim()}%`);
      nameFilter = `AND u."fullName" ILIKE $${params.length}`;
    }
    return AppDataSource.query(
      `
      SELECT u.id AS "userId",
             COALESCE(u."fullName", 'User') AS name,
             (u.email IS NOT NULL AND LENGTH(TRIM(u.email)) > 0) AS "hasEmail",
             u.role AS role,
             CASE WHEN u.role = 'STUDENT' THEN u."fullName" ELSE NULL END AS "studentName"
      FROM users u
      WHERE u.id = ANY($1::uuid[])
        AND u.status = $2
        AND u.role IN ('STUDENT', 'STAFF', 'OFFICE_STAFF', 'GUARDIAN', 'SUPER_ADMIN')
        ${nameFilter}
      ORDER BY COALESCE(u."fullName", 'User') ASC
      LIMIT ${RECIPIENT_LIMIT}
      `,
      params,
    ) as Promise<UserRow[]>;
  }

  private async resolveUsersByName(
    audience: CommunicationAudience,
  ): Promise<UserRow[]> {
    const status = defaultAudienceStatus(audience.status);
    return AppDataSource.query(
      `
      SELECT u.id AS "userId",
             COALESCE(u."fullName", 'User') AS name,
             (u.email IS NOT NULL AND LENGTH(TRIM(u.email)) > 0) AS "hasEmail",
             u.role AS role,
             CASE WHEN u.role = 'STUDENT' THEN u."fullName" ELSE NULL END AS "studentName"
      FROM users u
      WHERE u.status = $1
        AND (u."fullName" ILIKE $2 OR u."preferredName" ILIKE $2)
        AND u.role IN ('STUDENT', 'STAFF', 'OFFICE_STAFF', 'GUARDIAN', 'SUPER_ADMIN')
      ORDER BY COALESCE(u."fullName", 'User') ASC
      LIMIT ${RECIPIENT_LIMIT}
      `,
      [status, `%${audience.nameQuery!.trim()}%`],
    ) as Promise<UserRow[]>;
  }

  /** Students by name/preferred name — does not require an active enrolment. */
  private async studentsByName(
    audience: CommunicationAudience,
  ): Promise<UserRow[]> {
    const status = defaultAudienceStatus(audience.status);
    const q = `%${audience.nameQuery!.trim()}%`;
    return AppDataSource.query(
      `
      SELECT DISTINCT
        u.id AS "userId",
        COALESCE(st."fullName", u."fullName", 'Student') AS name,
        (u.email IS NOT NULL AND LENGTH(TRIM(u.email)) > 0) AS "hasEmail",
        u.role AS role,
        COALESCE(st."fullName", u."fullName") AS "studentName"
      FROM users u
      LEFT JOIN students st ON st."userId" = u.id
      WHERE u.status = $1
        AND u.role = $2
        AND (
          u."fullName" ILIKE $3
          OR u."preferredName" ILIKE $3
          OR st."fullName" ILIKE $3
        )
      ORDER BY COALESCE(st."fullName", u."fullName", 'Student') ASC
      LIMIT ${RECIPIENT_LIMIT}
      `,
      [status, UserRole.STUDENT, q],
    ) as Promise<UserRow[]>;
  }

  private async usersByRole(
    audience: CommunicationAudience,
    role: UserRole,
  ): Promise<UserRow[]> {
    const status = defaultAudienceStatus(audience.status);
    const params: unknown[] = [status, role];
    let nameFilter = "";
    if (audience.nameQuery?.trim()) {
      params.push(`%${audience.nameQuery.trim()}%`);
      nameFilter = `AND u."fullName" ILIKE $${params.length}`;
    }
    return AppDataSource.query(
      `
      SELECT u.id AS "userId",
             COALESCE(u."fullName", 'User') AS name,
             (u.email IS NOT NULL AND LENGTH(TRIM(u.email)) > 0) AS "hasEmail",
             u.role AS role,
             NULL::text AS "studentName"
      FROM users u
      WHERE u.status = $1 AND u.role = $2
        ${nameFilter}
      ORDER BY COALESCE(u."fullName", 'User') ASC
      LIMIT ${RECIPIENT_LIMIT}
      `,
      params,
    ) as Promise<UserRow[]>;
  }

  private async enrolledStudents(
    audience: CommunicationAudience,
  ): Promise<UserRow[]> {
    const status = defaultAudienceStatus(audience.status);
    const params: unknown[] = [status, UserRole.STUDENT];
    const filters = [`u.status = $1`, `u.role = $2`, `e.status = 'ACTIVE'`];

    if (audience.yearLevel?.trim()) {
      params.push(`%${audience.yearLevel.trim()}%`);
      const likeIdx = params.length;
      params.push(
        audience.yearLevel.trim().replace(/[^0-9]/g, "") ||
          audience.yearLevel.trim(),
      );
      const exactIdx = params.length;
      filters.push(
        `(yl.name ILIKE $${likeIdx} OR CAST(yl.sequence AS text) = $${exactIdx} OR CAST(st."yearLevel" AS text) ILIKE $${likeIdx})`,
      );
    }
    if (audience.term?.trim()) {
      params.push(`%${audience.term.trim()}%`);
      filters.push(`(term.name ILIKE $${params.length})`);
    }
    if (audience.subject?.trim()) {
      params.push(`%${audience.subject.trim()}%`);
      filters.push(`(sub.name ILIKE $${params.length})`);
    }
    if (audience.nameQuery?.trim()) {
      params.push(`%${audience.nameQuery.trim()}%`);
      filters.push(
        `(u."fullName" ILIKE $${params.length} OR u."preferredName" ILIKE $${params.length} OR st."fullName" ILIKE $${params.length})`,
      );
    }

    return AppDataSource.query(
      `
      SELECT DISTINCT
        u.id AS "userId",
        COALESCE(u."fullName", 'Student') AS name,
        (u.email IS NOT NULL AND LENGTH(TRIM(u.email)) > 0) AS "hasEmail",
        u.role AS role,
        COALESCE(st."fullName", u."fullName") AS "studentName"
      FROM enrollments e
      INNER JOIN students st ON st.id = e."studentId"
      INNER JOIN users u ON u.id = st."userId"
      LEFT JOIN terms term ON term.id = e."termId"
      LEFT JOIN year_levels yl ON yl.id = term."yearLevelId"
      LEFT JOIN enrollment_subjects es ON es."enrollmentId" = e.id
      LEFT JOIN subjects sub ON sub.id = es."subjectId"
      WHERE ${filters.join(" AND ")}
      ORDER BY COALESCE(u."fullName", 'Student') ASC
      LIMIT ${RECIPIENT_LIMIT}
      `,
      params,
    ) as Promise<UserRow[]>;
  }

  private async classRosterStudents(
    audience: CommunicationAudience,
  ): Promise<UserRow[]> {
    if (
      !audience.className?.trim() &&
      !audience.subject?.trim() &&
      !audience.yearLevel?.trim()
    ) {
      throw new AppError(
        400,
        "Provide class, subject, or year level for class roster targeting.",
        "ADMIN_AI_COMM_AUDIENCE_FILTER_REQUIRED",
      );
    }

    const status = defaultAudienceStatus(audience.status);
    const params: unknown[] = [status, UserRole.STUDENT];
    const filters = [`u.status = $1`, `u.role = $2`];

    if (audience.yearLevel?.trim()) {
      params.push(`%${audience.yearLevel.trim()}%`);
      const likeIdx = params.length;
      params.push(
        audience.yearLevel.trim().replace(/[^0-9]/g, "") ||
          audience.yearLevel.trim(),
      );
      const exactIdx = params.length;
      filters.push(
        `(yl.name ILIKE $${likeIdx} OR CAST(yl.sequence AS text) = $${exactIdx} OR c.name ILIKE $${likeIdx})`,
      );
    }
    if (audience.term?.trim()) {
      params.push(`%${audience.term.trim()}%`);
      filters.push(`(term.name ILIKE $${params.length})`);
    }
    if (audience.subject?.trim()) {
      params.push(`%${audience.subject.trim()}%`);
      filters.push(
        `(c.subject ILIKE $${params.length} OR c.name ILIKE $${params.length})`,
      );
    }
    if (audience.className?.trim()) {
      params.push(`%${audience.className.trim()}%`);
      filters.push(
        `(c.name ILIKE $${params.length} OR c.lesson ILIKE $${params.length})`,
      );
    }
    if (audience.nameQuery?.trim()) {
      params.push(`%${audience.nameQuery.trim()}%`);
      filters.push(`(u."fullName" ILIKE $${params.length})`);
    }

    return AppDataSource.query(
      `
      SELECT DISTINCT
        u.id AS "userId",
        COALESCE(u."fullName", 'Student') AS name,
        (u.email IS NOT NULL AND LENGTH(TRIM(u.email)) > 0) AS "hasEmail",
        u.role AS role,
        COALESCE(st."fullName", u."fullName") AS "studentName"
      FROM class_students cs
      INNER JOIN users u ON u.id = cs."studentId"
      LEFT JOIN students st ON st."userId" = u.id
      INNER JOIN classes c ON c.id = cs."classId"
      LEFT JOIN terms term ON term.id = c."termId"
      LEFT JOIN year_levels yl ON yl.id = term."yearLevelId"
      WHERE ${filters.join(" AND ")}
      ORDER BY COALESCE(u."fullName", 'Student') ASC
      LIMIT ${RECIPIENT_LIMIT}
      `,
      params,
    ) as Promise<UserRow[]>;
  }

  private async teachers(audience: CommunicationAudience): Promise<UserRow[]> {
    const status = defaultAudienceStatus(audience.status);
    const params: unknown[] = [status, UserRole.STAFF];
    const filters = [`u.status = $1`, `u.role = $2`];

    if (audience.subject?.trim()) {
      params.push(`%${audience.subject.trim()}%`);
      filters.push(
        `(EXISTS (
            SELECT 1 FROM teacher_subjects ts
            INNER JOIN subjects sub ON sub.id = ts."subjectId"
            WHERE ts."teacherId" = u.id AND sub.name ILIKE $${params.length}
          )
          OR EXISTS (
            SELECT 1 FROM classes c
            WHERE c."teacherId" = u.id
              AND (c.subject ILIKE $${params.length} OR c.name ILIKE $${params.length})
          ))`,
      );
    }
    if (audience.yearLevel?.trim()) {
      params.push(`%${audience.yearLevel.trim()}%`);
      const likeIdx = params.length;
      params.push(
        audience.yearLevel.trim().replace(/[^0-9]/g, "") ||
          audience.yearLevel.trim(),
      );
      const exactIdx = params.length;
      filters.push(
        `EXISTS (
          SELECT 1 FROM classes c
          LEFT JOIN terms term ON term.id = c."termId"
          LEFT JOIN year_levels yl ON yl.id = term."yearLevelId"
          WHERE c."teacherId" = u.id
            AND (yl.name ILIKE $${likeIdx} OR CAST(yl.sequence AS text) = $${exactIdx} OR c.name ILIKE $${likeIdx})
        )`,
      );
    }
    if (audience.nameQuery?.trim()) {
      params.push(`%${audience.nameQuery.trim()}%`);
      filters.push(`u."fullName" ILIKE $${params.length}`);
    }

    return AppDataSource.query(
      `
      SELECT DISTINCT
        u.id AS "userId",
        COALESCE(u."fullName", 'Teacher') AS name,
        (u.email IS NOT NULL AND LENGTH(TRIM(u.email)) > 0) AS "hasEmail",
        u.role AS role,
        NULL::text AS "studentName"
      FROM users u
      WHERE ${filters.join(" AND ")}
      ORDER BY COALESCE(u."fullName", 'Teacher') ASC
      LIMIT ${RECIPIENT_LIMIT}
      `,
      params,
    ) as Promise<UserRow[]>;
  }

  private async officeStaff(
    audience: CommunicationAudience,
  ): Promise<UserRow[]> {
    return this.usersByRole(audience, UserRole.OFFICE_STAFF);
  }

  private async guardians(
    audience: CommunicationAudience,
  ): Promise<UserRow[]> {
    const status = defaultAudienceStatus(audience.status);
    const params: unknown[] = [status, UserRole.GUARDIAN];
    const filters = [`g.status = $1`, `g.role = $2`];

    if (audience.yearLevel?.trim()) {
      params.push(`%${audience.yearLevel.trim()}%`);
      filters.push(`(CAST(st."yearLevel" AS text) ILIKE $${params.length})`);
    }
    if (audience.nameQuery?.trim()) {
      params.push(`%${audience.nameQuery.trim()}%`);
      filters.push(`g."fullName" ILIKE $${params.length}`);
    }

    return AppDataSource.query(
      `
      SELECT DISTINCT
        g.id AS "userId",
        COALESCE(g."fullName", 'Guardian') AS name,
        (g.email IS NOT NULL AND LENGTH(TRIM(g.email)) > 0) AS "hasEmail",
        g.role AS role,
        st."fullName" AS "studentName"
      FROM users g
      INNER JOIN guardian_students gs ON gs."guardianId" = g.id
      INNER JOIN students st ON st.id = gs."studentId"
      WHERE ${filters.join(" AND ")}
      ORDER BY COALESCE(g."fullName", 'Guardian') ASC
      LIMIT ${RECIPIENT_LIMIT}
      `,
      params,
    ) as Promise<UserRow[]>;
  }

  private async overdueHomeworkStudents(
    audience: CommunicationAudience,
  ): Promise<UserRow[]> {
    const params: unknown[] = [];
    const filters: string[] = [];

    if (audience.yearLevel?.trim()) {
      params.push(`%${audience.yearLevel.trim()}%`);
      filters.push(
        `(h."yearGroup" ILIKE $${params.length} OR CAST(st."yearLevel" AS text) ILIKE $${params.length})`,
      );
    }
    if (audience.subject?.trim()) {
      params.push(`%${audience.subject.trim()}%`);
      filters.push(`(sub.name ILIKE $${params.length})`);
    }
    if (audience.term?.trim()) {
      params.push(`%${audience.term.trim()}%`);
      filters.push(`(term.name ILIKE $${params.length})`);
    }
    if (audience.nameQuery?.trim()) {
      params.push(`%${audience.nameQuery.trim()}%`);
      filters.push(`(su."fullName" ILIKE $${params.length})`);
    }

    const extra = filters.length ? `AND ${filters.join(" AND ")}` : "";

    return AppDataSource.query(
      `
      SELECT DISTINCT
        su.id AS "userId",
        COALESCE(su."fullName", 'Student') AS name,
        (su.email IS NOT NULL AND LENGTH(TRIM(su.email)) > 0) AS "hasEmail",
        su.role AS role,
        COALESCE(st."fullName", su."fullName") AS "studentName"
      FROM homework h
      INNER JOIN homework_students hs ON hs."homeworkId" = h.id
      INNER JOIN users su ON su.id = hs."studentId"
      LEFT JOIN homework_submissions subm
        ON subm."homeworkId" = h.id
       AND subm."studentId" = hs."studentId"
       AND subm.status = 'SUBMITTED'
      LEFT JOIN subjects sub ON sub.id = h."subjectId"
      LEFT JOIN terms term ON term.id = h."termId"
      LEFT JOIN students st ON st."userId" = hs."studentId"
      WHERE h."dueDate" < CURRENT_DATE
        AND subm.id IS NULL
        AND su.status = 'ACTIVE'
        ${extra}
      ORDER BY COALESCE(su."fullName", 'Student') ASC
      LIMIT ${RECIPIENT_LIMIT}
      `,
      params,
    ) as Promise<UserRow[]>;
  }

  private async absenceStudents(
    audience: CommunicationAudience,
  ): Promise<UserRow[]> {
    const day = dayBoundsInClassTz(audience.date ?? undefined);
    const params: unknown[] = [day.start, day.end];
    let yearFilter = "";
    if (audience.yearLevel?.trim()) {
      params.push(`%${audience.yearLevel.trim()}%`);
      const likeIdx = params.length;
      params.push(
        audience.yearLevel.trim().replace(/[^0-9]/g, "") ||
          audience.yearLevel.trim(),
      );
      const exactIdx = params.length;
      yearFilter = `
        AND (
          yl.name ILIKE $${likeIdx}
          OR CAST(yl.sequence AS text) = $${exactIdx}
          OR c.name ILIKE $${likeIdx}
        )
      `;
    }

    return AppDataSource.query(
      `
      SELECT DISTINCT
        u.id AS "userId",
        COALESCE(u."fullName", 'Student') AS name,
        (u.email IS NOT NULL AND LENGTH(TRIM(u.email)) > 0) AS "hasEmail",
        u.role AS role,
        u."fullName" AS "studentName"
      FROM attendance_records ar
      INNER JOIN sessions s ON s.id = ar."sessionId"
      INNER JOIN users u ON u.id = ar."studentId"
      LEFT JOIN classes c ON c.id = s."classId"
      LEFT JOIN terms t ON t.id = c."termId"
      LEFT JOIN year_levels yl ON yl.id = t."yearLevelId"
      WHERE s."startAt" >= $1
        AND s."startAt" < $2
        AND ar.status IN ('ABSENT', 'EXCUSED', 'PENDING')
        AND u.status = 'ACTIVE'
        ${yearFilter}
      ORDER BY COALESCE(u."fullName", 'Student') ASC
      LIMIT ${RECIPIENT_LIMIT}
      `,
      params,
    ) as Promise<UserRow[]>;
  }

  private async sessionTeachers(
    audience: CommunicationAudience,
  ): Promise<UserRow[]> {
    const day = dayBoundsInClassTz(audience.date ?? undefined);
    const params: unknown[] = [day.start, day.end, UserStatus.ACTIVE];
    let yearFilter = "";
    let subjectFilter = "";

    if (audience.yearLevel?.trim()) {
      params.push(`%${audience.yearLevel.trim()}%`);
      const likeIdx = params.length;
      params.push(
        audience.yearLevel.trim().replace(/[^0-9]/g, "") ||
          audience.yearLevel.trim(),
      );
      const exactIdx = params.length;
      yearFilter = `
        AND (
          yl.name ILIKE $${likeIdx}
          OR CAST(yl.sequence AS text) = $${exactIdx}
          OR c.name ILIKE $${likeIdx}
        )
      `;
    }
    if (audience.subject?.trim()) {
      params.push(`%${audience.subject.trim()}%`);
      subjectFilter = `AND (c.subject ILIKE $${params.length} OR c.name ILIKE $${params.length})`;
    }

    return AppDataSource.query(
      `
      SELECT DISTINCT
        u.id AS "userId",
        COALESCE(u."fullName", 'Teacher') AS name,
        (u.email IS NOT NULL AND LENGTH(TRIM(u.email)) > 0) AS "hasEmail",
        u.role AS role,
        NULL::text AS "studentName"
      FROM sessions s
      INNER JOIN classes c ON c.id = s."classId"
      LEFT JOIN terms term ON term.id = c."termId"
      LEFT JOIN year_levels yl ON yl.id = term."yearLevelId"
      INNER JOIN users u ON u.id = COALESCE(s."teacherId", c."teacherId")
      WHERE s."startAt" >= $1
        AND s."startAt" < $2
        AND u.status = $3
        AND u.role = 'STAFF'
        ${yearFilter}
        ${subjectFilter}
      ORDER BY COALESCE(u."fullName", 'Teacher') ASC
      LIMIT ${RECIPIENT_LIMIT}
      `,
      params,
    ) as Promise<UserRow[]>;
  }

  private async assessmentParticipants(
    audience: CommunicationAudience,
  ): Promise<UserRow[]> {
    const params: unknown[] = [UserStatus.ACTIVE];
    const filters = [`u.status = $1`, `u.role = 'STUDENT'`];

    if (audience.assessmentQuery?.trim()) {
      params.push(`%${audience.assessmentQuery.trim()}%`);
      filters.push(
        `(a.name ILIKE $${params.length} OR a.subject ILIKE $${params.length})`,
      );
    }
    if (audience.subject?.trim()) {
      params.push(`%${audience.subject.trim()}%`);
      filters.push(`(a.subject ILIKE $${params.length})`);
    }
    if (audience.yearLevel?.trim()) {
      params.push(`%${audience.yearLevel.trim()}%`);
      filters.push(
        `(a."yearGroup" ILIKE $${params.length} OR yl.name ILIKE $${params.length})`,
      );
    }
    if (audience.term?.trim()) {
      params.push(`%${audience.term.trim()}%`);
      filters.push(`(term.name ILIKE $${params.length})`);
    }
    if (audience.nameQuery?.trim()) {
      params.push(`%${audience.nameQuery.trim()}%`);
      filters.push(`(u."fullName" ILIKE $${params.length})`);
    }

    if (!audience.assessmentQuery?.trim() && !audience.subject?.trim()) {
      throw new AppError(
        400,
        "Provide an assessment name or subject to target assessment participants.",
        "ADMIN_AI_COMM_AUDIENCE_FILTER_REQUIRED",
      );
    }

    return AppDataSource.query(
      `
      SELECT DISTINCT
        u.id AS "userId",
        COALESCE(u."fullName", 'Student') AS name,
        (u.email IS NOT NULL AND LENGTH(TRIM(u.email)) > 0) AS "hasEmail",
        u.role AS role,
        u."fullName" AS "studentName"
      FROM assessment_students ast
      INNER JOIN assessments a ON a.id = ast."assessmentId"
      INNER JOIN users u ON u.id = ast."studentId"
      LEFT JOIN terms term ON term.id = a."termId"
      LEFT JOIN year_levels yl ON yl.id = term."yearLevelId"
      WHERE ${filters.join(" AND ")}
      ORDER BY COALESCE(u."fullName", 'Student') ASC
      LIMIT ${RECIPIENT_LIMIT}
      `,
      params,
    ) as Promise<UserRow[]>;
  }

  /**
   * Enquiry guardians matched to existing GUARDIAN users by email.
   * Raw enquiry emails without a user account are skipped (no invented users).
   */
  private async enquiryContacts(
    audience: CommunicationAudience,
  ): Promise<UserRow[]> {
    const params: unknown[] = [UserStatus.ACTIVE, UserRole.GUARDIAN];
    const filters = [
      `g.status = $1`,
      `g.role = $2`,
      `e."guardianEmail" IS NOT NULL`,
      `LENGTH(TRIM(e."guardianEmail")) > 0`,
    ];

    if (audience.enquiryStage?.trim()) {
      params.push(`%${audience.enquiryStage.trim()}%`);
      filters.push(`(stage.name ILIKE $${params.length})`);
    }
    if (audience.subject?.trim()) {
      params.push(`%${audience.subject.trim()}%`);
      filters.push(`(e."subjectOfInterest" ILIKE $${params.length})`);
    }
    if (audience.yearLevel?.trim()) {
      params.push(audience.yearLevel.trim().replace(/[^0-9]/g, "") || audience.yearLevel.trim());
      filters.push(`(CAST(e."yearLevel" AS text) = $${params.length})`);
    }
    if (audience.nameQuery?.trim()) {
      params.push(`%${audience.nameQuery.trim()}%`);
      filters.push(
        `(g."fullName" ILIKE $${params.length} OR e."guardianFullName" ILIKE $${params.length})`,
      );
    }

    return AppDataSource.query(
      `
      SELECT DISTINCT
        g.id AS "userId",
        COALESCE(g."fullName", e."guardianFullName", 'Guardian') AS name,
        (g.email IS NOT NULL AND LENGTH(TRIM(g.email)) > 0) AS "hasEmail",
        g.role AS role,
        e."studentFullName" AS "studentName"
      FROM enquiries e
      INNER JOIN users g
        ON LOWER(TRIM(g.email)) = LOWER(TRIM(e."guardianEmail"))
      LEFT JOIN enquiry_stages stage ON stage.id = e."currentStageId"
      WHERE ${filters.join(" AND ")}
      ORDER BY COALESCE(g."fullName", e."guardianFullName", 'Guardian') ASC
      LIMIT ${RECIPIENT_LIMIT}
      `,
      params,
    ) as Promise<UserRow[]>;
  }

  private async guardiansForStudentUsers(
    studentUserIds: string[],
  ): Promise<UserRow[]> {
    const ids = [...new Set(studentUserIds.filter(Boolean))].slice(
      0,
      RECIPIENT_LIMIT,
    );
    if (!ids.length) return [];

    const fromLinks = (await AppDataSource.query(
      `
      SELECT DISTINCT
        g.id AS "userId",
        COALESCE(g."fullName", 'Guardian') AS name,
        (g.email IS NOT NULL AND LENGTH(TRIM(g.email)) > 0) AS "hasEmail",
        g.role AS role,
        COALESCE(st."fullName", su."fullName") AS "studentName",
        'Guardian'::text AS "relationshipLabel"
      FROM users su
      INNER JOIN students st ON st."userId" = su.id
      INNER JOIN guardian_students gs ON gs."studentId" = st.id
      INNER JOIN users g ON g.id = gs."guardianId"
      WHERE su.id = ANY($1::uuid[])
        AND g.status = 'ACTIVE'
        AND g.role = 'GUARDIAN'
      `,
      [ids],
    )) as UserRow[];

    const fromEnrollments = (await AppDataSource.query(
      `
      SELECT DISTINCT
        g.id AS "userId",
        COALESCE(g."fullName", 'Guardian') AS name,
        (g.email IS NOT NULL AND LENGTH(TRIM(g.email)) > 0) AS "hasEmail",
        g.role AS role,
        COALESCE(st."fullName", su."fullName") AS "studentName",
        'Guardian'::text AS "relationshipLabel"
      FROM users su
      INNER JOIN students st ON st."userId" = su.id
      INNER JOIN enrollments e ON e."studentId" = st.id
      INNER JOIN users g ON g.id = e."guardianId"
      WHERE su.id = ANY($1::uuid[])
        AND g.status = 'ACTIVE'
        AND g.role = 'GUARDIAN'
      `,
      [ids],
    )) as UserRow[];

    return [...fromLinks, ...fromEnrollments];
  }

  async resolveStudentsForAudience(
    audience: CommunicationAudience,
  ): Promise<UserRow[]> {
    const selfAudience: CommunicationAudience = {
      ...audience,
      recipientOf: "SELF",
    };
    if (selfAudience.ambiguous && !selfAudience.confirmed) return [];
    const groups = (selfAudience.groups ?? [])
      .map((g) => normalizeGroup(g))
      .filter((g): g is AudienceGroup => Boolean(g));
    if (groups.length) {
      let rows = await this.resolveGroup(groups[0]!, selfAudience);
      for (const group of groups.slice(1)) {
        rows = intersectByUserId(rows, await this.resolveGroup(group, selfAudience));
      }
      return rows;
    }
    if (selfAudience.userIds?.length) {
      return this.resolveUsersByIds(selfAudience);
    }
    return this.resolveByRolesAndAcademic(selfAudience);
  }
}

export const audienceResolverService = new AudienceResolverService();
