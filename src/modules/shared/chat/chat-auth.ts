import { AppDataSource } from "../../../config/data-source.js";
import { AppError } from "../../../common/errors/AppError.js";
import { UserRole, UserStatus } from "../../../common/constants/roles.js";
import { settingsService } from "../../settings/settings.service.js";
import type { ChatConversationKind } from "../../../entities/ChatConversation.js";

export type ChatPeer = {
  userId: string;
  fullName: string;
  preferredName: string | null;
  role: UserRole;
  sharedClasses: Array<{
    classId: string;
    className: string;
    subject: string | null;
  }>;
  /** Short label, e.g. "Parent of Mia" for guardians. */
  subtitle?: string | null;
};

export type ChatPair =
  | {
      kind: "STUDENT_TEACHER";
      studentUserId: string;
      teacherUserId: string;
      guardianUserId: null;
      peerTeacherUserId: null;
      adminUserId: null;
    }
  | {
      kind: "GUARDIAN_TEACHER";
      studentUserId: null;
      teacherUserId: string;
      guardianUserId: string;
      peerTeacherUserId: null;
      adminUserId: null;
    }
  | {
      kind: "TEACHER_TEACHER";
      studentUserId: null;
      teacherUserId: string;
      guardianUserId: null;
      peerTeacherUserId: string;
      adminUserId: null;
    }
  | {
      kind: "OFFICE_STAFF_OFFICE_STAFF";
      studentUserId: null;
      teacherUserId: string;
      guardianUserId: null;
      peerTeacherUserId: string;
      adminUserId: null;
    }
  | {
      kind: "GUARDIAN_ADMIN";
      studentUserId: null;
      teacherUserId: null;
      guardianUserId: string;
      peerTeacherUserId: null;
      adminUserId: string;
    }
  | {
      kind: "STUDENT_ADMIN";
      studentUserId: string;
      teacherUserId: null;
      guardianUserId: null;
      peerTeacherUserId: null;
      adminUserId: string;
    }
  | {
      kind: "OFFICE_TEACHER";
      studentUserId: null;
      teacherUserId: string;
      guardianUserId: null;
      peerTeacherUserId: null;
      adminUserId: string;
    }
  | {
      kind: "OFFICE_ADMIN";
      studentUserId: null;
      teacherUserId: string;
      guardianUserId: null;
      peerTeacherUserId: null;
      adminUserId: string;
    }
  | {
      kind: "TEACHER_ADMIN";
      studentUserId: null;
      teacherUserId: string;
      guardianUserId: null;
      peerTeacherUserId: null;
      adminUserId: string;
    };

export function isAdminChatRole(role: UserRole) {
  return role === UserRole.SUPER_ADMIN;
}

/** Canonical order so peer pairs are unique regardless of who opens. */
export function orderedTeacherPair(a: string, b: string): {
  teacherUserId: string;
  peerTeacherUserId: string;
} {
  return a < b
    ? { teacherUserId: a, peerTeacherUserId: b }
    : { teacherUserId: b, peerTeacherUserId: a };
}

function displayName(peer: {
  fullName: string;
  preferredName: string | null;
}) {
  return peer.preferredName?.trim() || peer.fullName;
}

function parseSharedClasses(
  value: ChatPeer["sharedClasses"] | string,
): ChatPeer["sharedClasses"] {
  return Array.isArray(value)
    ? value
    : (JSON.parse(String(value)) as ChatPeer["sharedClasses"]);
}

/**
 * Teachers a student may message: class teacher or session override teacher
 * for any class the student is rostered on.
 */
export async function listTeachersForStudent(
  studentUserId: string,
): Promise<ChatPeer[]> {
  const rows = (await AppDataSource.query(
    `
    WITH links AS (
      SELECT DISTINCT
        c.id AS "classId",
        c.name AS "className",
        c.subject AS "subject",
        c."teacherId" AS "teacherUserId"
      FROM class_students cs
      INNER JOIN classes c ON c.id = cs."classId"
      WHERE cs."studentId" = $1
        AND c."teacherId" IS NOT NULL

      UNION

      SELECT DISTINCT
        c.id AS "classId",
        c.name AS "className",
        c.subject AS "subject",
        s."teacherId" AS "teacherUserId"
      FROM class_students cs
      INNER JOIN classes c ON c.id = cs."classId"
      INNER JOIN sessions s ON s."classId" = c.id
      WHERE cs."studentId" = $1
        AND s."teacherId" IS NOT NULL
    )
    SELECT
      u.id AS "userId",
      u."fullName" AS "fullName",
      u."preferredName" AS "preferredName",
      u.role AS "role",
      COALESCE(
        json_agg(
          DISTINCT jsonb_build_object(
            'classId', links."classId",
            'className', links."className",
            'subject', links."subject"
          )
        ) FILTER (WHERE links."classId" IS NOT NULL),
        '[]'::json
      ) AS "sharedClasses"
    FROM links
    INNER JOIN users u ON u.id = links."teacherUserId"
    WHERE u.role = $2
      AND u.status = $3
    GROUP BY u.id, u."fullName", u."preferredName", u.role
    ORDER BY COALESCE(NULLIF(u."preferredName", ''), u."fullName") ASC
    `,
    [studentUserId, UserRole.STAFF, UserStatus.ACTIVE],
  )) as Array<{
    userId: string;
    fullName: string;
    preferredName: string | null;
    role: UserRole;
    sharedClasses: ChatPeer["sharedClasses"] | string;
  }>;

  return rows.map((row) => ({
    userId: row.userId,
    fullName: row.fullName,
    preferredName: row.preferredName,
    role: row.role,
    sharedClasses: parseSharedClasses(row.sharedClasses),
  }));
}

/**
 * Students a teacher may message: rostered on classes they own or sessions
 * they teach.
 */
export async function listStudentsForTeacher(
  teacherUserId: string,
): Promise<ChatPeer[]> {
  const rows = (await AppDataSource.query(
    `
    WITH links AS (
      SELECT DISTINCT
        c.id AS "classId",
        c.name AS "className",
        c.subject AS "subject",
        cs."studentId" AS "studentUserId"
      FROM classes c
      INNER JOIN class_students cs ON cs."classId" = c.id
      WHERE c."teacherId" = $1

      UNION

      SELECT DISTINCT
        c.id AS "classId",
        c.name AS "className",
        c.subject AS "subject",
        cs."studentId" AS "studentUserId"
      FROM sessions s
      INNER JOIN classes c ON c.id = s."classId"
      INNER JOIN class_students cs ON cs."classId" = c.id
      WHERE s."teacherId" = $1
        AND s."classId" IS NOT NULL
    )
    SELECT
      u.id AS "userId",
      u."fullName" AS "fullName",
      u."preferredName" AS "preferredName",
      u.role AS "role",
      COALESCE(
        json_agg(
          DISTINCT jsonb_build_object(
            'classId', links."classId",
            'className', links."className",
            'subject', links."subject"
          )
        ) FILTER (WHERE links."classId" IS NOT NULL),
        '[]'::json
      ) AS "sharedClasses"
    FROM links
    INNER JOIN users u ON u.id = links."studentUserId"
    WHERE u.role = $2
      AND u.status = $3
    GROUP BY u.id, u."fullName", u."preferredName", u.role
    ORDER BY COALESCE(NULLIF(u."preferredName", ''), u."fullName") ASC
    `,
    [teacherUserId, UserRole.STUDENT, UserStatus.ACTIVE],
  )) as Array<{
    userId: string;
    fullName: string;
    preferredName: string | null;
    role: UserRole;
    sharedClasses: ChatPeer["sharedClasses"] | string;
  }>;

  return rows.map((row) => ({
    userId: row.userId,
    fullName: row.fullName,
    preferredName: row.preferredName,
    role: row.role,
    sharedClasses: parseSharedClasses(row.sharedClasses),
  }));
}

/**
 * Teachers a guardian may message: teachers of any linked student's classes.
 */
export async function listTeachersForGuardian(
  guardianUserId: string,
): Promise<ChatPeer[]> {
  const rows = (await AppDataSource.query(
    `
    WITH linked_students AS (
      SELECT s."userId" AS "studentUserId"
      FROM guardian_students gs
      INNER JOIN students s ON s.id = gs."studentId"
      WHERE gs."guardianId" = $1
        AND s."userId" IS NOT NULL
    ),
    links AS (
      SELECT DISTINCT
        c.id AS "classId",
        c.name AS "className",
        c.subject AS "subject",
        c."teacherId" AS "teacherUserId"
      FROM class_students cs
      INNER JOIN classes c ON c.id = cs."classId"
      INNER JOIN linked_students ls ON ls."studentUserId" = cs."studentId"
      WHERE c."teacherId" IS NOT NULL

      UNION

      SELECT DISTINCT
        c.id AS "classId",
        c.name AS "className",
        c.subject AS "subject",
        s."teacherId" AS "teacherUserId"
      FROM class_students cs
      INNER JOIN classes c ON c.id = cs."classId"
      INNER JOIN sessions s ON s."classId" = c.id
      INNER JOIN linked_students ls ON ls."studentUserId" = cs."studentId"
      WHERE s."teacherId" IS NOT NULL
    )
    SELECT
      u.id AS "userId",
      u."fullName" AS "fullName",
      u."preferredName" AS "preferredName",
      u.role AS "role",
      COALESCE(
        json_agg(
          DISTINCT jsonb_build_object(
            'classId', links."classId",
            'className', links."className",
            'subject', links."subject"
          )
        ) FILTER (WHERE links."classId" IS NOT NULL),
        '[]'::json
      ) AS "sharedClasses"
    FROM links
    INNER JOIN users u ON u.id = links."teacherUserId"
    WHERE u.role = $2
      AND u.status = $3
    GROUP BY u.id, u."fullName", u."preferredName", u.role
    ORDER BY COALESCE(NULLIF(u."preferredName", ''), u."fullName") ASC
    `,
    [guardianUserId, UserRole.STAFF, UserStatus.ACTIVE],
  )) as Array<{
    userId: string;
    fullName: string;
    preferredName: string | null;
    role: UserRole;
    sharedClasses: ChatPeer["sharedClasses"] | string;
  }>;

  return rows.map((row) => ({
    userId: row.userId,
    fullName: row.fullName,
    preferredName: row.preferredName,
    role: row.role,
    sharedClasses: parseSharedClasses(row.sharedClasses),
  }));
}

/**
 * Guardians a teacher may message: guardians linked to students they teach.
 */
export async function listGuardiansForTeacher(
  teacherUserId: string,
): Promise<ChatPeer[]> {
  const rows = (await AppDataSource.query(
    `
    WITH taught_students AS (
      SELECT DISTINCT cs."studentId" AS "studentUserId"
      FROM classes c
      INNER JOIN class_students cs ON cs."classId" = c.id
      WHERE c."teacherId" = $1

      UNION

      SELECT DISTINCT cs."studentId" AS "studentUserId"
      FROM sessions s
      INNER JOIN classes c ON c.id = s."classId"
      INNER JOIN class_students cs ON cs."classId" = c.id
      WHERE s."teacherId" = $1
        AND s."classId" IS NOT NULL
    ),
    guardian_links AS (
      SELECT
        gs."guardianId" AS "guardianUserId",
        COALESCE(NULLIF(su."preferredName", ''), su."fullName", st."fullName") AS "studentName",
        c.id AS "classId",
        c.name AS "className",
        c.subject AS "subject",
        t.name AS "termName",
        yl.name AS "yearLevelName"
      FROM taught_students ts
      INNER JOIN students st ON st."userId" = ts."studentUserId"
      INNER JOIN guardian_students gs ON gs."studentId" = st.id
      INNER JOIN users su ON su.id = st."userId"
      LEFT JOIN class_students cs ON cs."studentId" = ts."studentUserId"
      LEFT JOIN classes c ON c.id = cs."classId"
        AND (c."teacherId" = $1 OR EXISTS (
          SELECT 1 FROM sessions s
          WHERE s."classId" = c.id AND s."teacherId" = $1
        ))
      LEFT JOIN terms t ON t.id = c."termId"
      LEFT JOIN year_levels yl ON yl.id = t."yearLevelId"
    )
    SELECT
      u.id AS "userId",
      u."fullName" AS "fullName",
      u."preferredName" AS "preferredName",
      u.role AS "role",
      COALESCE(
        json_agg(
          DISTINCT jsonb_build_object(
            'classId', gl."classId",
            'className', gl."className",
            'subject', gl."subject"
          )
        ) FILTER (WHERE gl."classId" IS NOT NULL),
        '[]'::json
      ) AS "sharedClasses",
      COALESCE(
        string_agg(DISTINCT gl."studentName", ', '),
        ''
      ) AS "studentNames",
      COALESCE(
        string_agg(
          DISTINCT NULLIF(
            trim(
              concat_ws(
                ' · ',
                NULLIF(gl."yearLevelName", ''),
                NULLIF(gl."termName", '')
              )
            ),
            ''
          ),
          ', '
        ),
        ''
      ) AS "termLabels"
    FROM guardian_links gl
    INNER JOIN users u ON u.id = gl."guardianUserId"
    WHERE u.role = $2
      AND u.status = $3
    GROUP BY u.id, u."fullName", u."preferredName", u.role
    ORDER BY COALESCE(NULLIF(u."preferredName", ''), u."fullName") ASC
    `,
    [teacherUserId, UserRole.GUARDIAN, UserStatus.ACTIVE],
  )) as Array<{
    userId: string;
    fullName: string;
    preferredName: string | null;
    role: UserRole;
    sharedClasses: ChatPeer["sharedClasses"] | string;
    studentNames: string;
    termLabels: string;
  }>;

  return rows.map((row) => {
    const parentLabel = row.studentNames
      ? `Parent of ${row.studentNames}`
      : "Guardian";
    const parts = [parentLabel, row.termLabels].filter(Boolean);
    return {
      userId: row.userId,
      fullName: row.fullName,
      preferredName: row.preferredName,
      role: row.role,
      sharedClasses: parseSharedClasses(row.sharedClasses),
      subtitle: parts.join(" · "),
    };
  });
}

/**
 * Other teachers who share at least one class term (same year level + term)
 * via class ownership or session teaching.
 */
export async function listTeachersForTeacher(
  teacherUserId: string,
): Promise<ChatPeer[]> {
  const rows = (await AppDataSource.query(
    `
    WITH my_terms AS (
      SELECT DISTINCT c."termId" AS "termId"
      FROM classes c
      WHERE c."teacherId" = $1
        AND c."termId" IS NOT NULL

      UNION

      SELECT DISTINCT c."termId" AS "termId"
      FROM sessions s
      INNER JOIN classes c ON c.id = s."classId"
      WHERE s."teacherId" = $1
        AND c."termId" IS NOT NULL
    ),
    links AS (
      SELECT DISTINCT
        c.id AS "classId",
        c.name AS "className",
        c.subject AS "subject",
        c."teacherId" AS "teacherUserId",
        t.name AS "termName",
        yl.name AS "yearLevelName"
      FROM classes c
      INNER JOIN my_terms mt ON mt."termId" = c."termId"
      INNER JOIN terms t ON t.id = c."termId"
      LEFT JOIN year_levels yl ON yl.id = t."yearLevelId"
      WHERE c."teacherId" IS NOT NULL
        AND c."teacherId" <> $1

      UNION

      SELECT DISTINCT
        c.id AS "classId",
        c.name AS "className",
        c.subject AS "subject",
        s."teacherId" AS "teacherUserId",
        t.name AS "termName",
        yl.name AS "yearLevelName"
      FROM sessions s
      INNER JOIN classes c ON c.id = s."classId"
      INNER JOIN my_terms mt ON mt."termId" = c."termId"
      INNER JOIN terms t ON t.id = c."termId"
      LEFT JOIN year_levels yl ON yl.id = t."yearLevelId"
      WHERE s."teacherId" IS NOT NULL
        AND s."teacherId" <> $1
        AND s."classId" IS NOT NULL
    )
    SELECT
      u.id AS "userId",
      u."fullName" AS "fullName",
      u."preferredName" AS "preferredName",
      u.role AS "role",
      COALESCE(
        json_agg(
          DISTINCT jsonb_build_object(
            'classId', links."classId",
            'className', links."className",
            'subject', links."subject"
          )
        ) FILTER (WHERE links."classId" IS NOT NULL),
        '[]'::json
      ) AS "sharedClasses",
      COALESCE(
        string_agg(
          DISTINCT NULLIF(
            trim(
              concat_ws(
                ' · ',
                NULLIF(links."yearLevelName", ''),
                NULLIF(links."termName", '')
              )
            ),
            ''
          ),
          ', '
        ),
        ''
      ) AS "termLabels"
    FROM links
    INNER JOIN users u ON u.id = links."teacherUserId"
    WHERE u.role = $2
      AND u.status = $3
    GROUP BY u.id, u."fullName", u."preferredName", u.role
    ORDER BY COALESCE(NULLIF(u."preferredName", ''), u."fullName") ASC
    `,
    [teacherUserId, UserRole.STAFF, UserStatus.ACTIVE],
  )) as Array<{
    userId: string;
    fullName: string;
    preferredName: string | null;
    role: UserRole;
    sharedClasses: ChatPeer["sharedClasses"] | string;
    termLabels: string;
  }>;

  return rows.map((row) => {
    const parts = ["Teacher", row.termLabels].filter(Boolean);
    return {
      userId: row.userId,
      fullName: row.fullName,
      preferredName: row.preferredName,
      role: row.role,
      sharedClasses: parseSharedClasses(row.sharedClasses),
      subtitle: parts.join(" · "),
    };
  });
}

export async function assertGuardianTeacherChatEnabled() {
  if (!(await settingsService.isGuardianTeacherChatEnabled())) {
    throw new AppError(
      403,
      "Guardian–teacher chat is not enabled",
      "CHAT_DISABLED",
    );
  }
}

export async function assertTeacherTeacherChatEnabled() {
  if (!(await settingsService.isTeacherTeacherChatEnabled())) {
    throw new AppError(
      403,
      "Teacher–teacher chat is not enabled",
      "CHAT_DISABLED",
    );
  }
}

export async function assertGuardianAdminChatEnabled() {
  if (!(await settingsService.isGuardianAdminChatEnabled())) {
    throw new AppError(
      403,
      "Guardian–admin chat is not enabled",
      "CHAT_DISABLED",
    );
  }
}

/** Active Super Admins a guardian may message. */
export async function listAdminsForGuardian(
  _guardianUserId: string,
): Promise<ChatPeer[]> {
  const rows = (await AppDataSource.query(
    `
    SELECT
      u.id AS "userId",
      u."fullName" AS "fullName",
      u."preferredName" AS "preferredName",
      u.role AS "role",
      '[]'::json AS "sharedClasses"
    FROM users u
    WHERE u.role = $1
      AND u.status = $2
    ORDER BY COALESCE(NULLIF(u."preferredName", ''), u."fullName") ASC
    `,
    [UserRole.SUPER_ADMIN, UserStatus.ACTIVE],
  )) as Array<{
    userId: string;
    fullName: string;
    preferredName: string | null;
    role: UserRole;
    sharedClasses: ChatPeer["sharedClasses"] | string;
  }>;

  return rows.map((row) => ({
    userId: row.userId,
    fullName: row.fullName,
    preferredName: row.preferredName,
    role: row.role,
    sharedClasses: parseSharedClasses(row.sharedClasses),
    subtitle: "Super Admin",
  }));
}

/** Other active office staff a given office staff member may message. */
export async function listOfficeStaffForOfficeStaff(
  officeStaffUserId: string,
): Promise<ChatPeer[]> {
  const rows = (await AppDataSource.query(
    `
    SELECT
      u.id AS "userId",
      u."fullName" AS "fullName",
      u."preferredName" AS "preferredName",
      u.role AS "role",
      '[]'::json AS "sharedClasses"
    FROM users u
    WHERE u.role = $1
      AND u.status = $2
      AND u.id <> $3
    ORDER BY COALESCE(NULLIF(u."preferredName", ''), u."fullName") ASC
    `,
    [UserRole.OFFICE_STAFF, UserStatus.ACTIVE, officeStaffUserId],
  )) as Array<{
    userId: string;
    fullName: string;
    preferredName: string | null;
    role: UserRole;
    sharedClasses: ChatPeer["sharedClasses"] | string;
  }>;

  return rows.map((row) => ({
    userId: row.userId,
    fullName: row.fullName,
    preferredName: row.preferredName,
    role: row.role,
    sharedClasses: parseSharedClasses(row.sharedClasses),
    subtitle: "Office Staff",
  }));
}

export async function assertOfficeStaffChatEnabled() {
  if (!(await settingsService.isOfficeStaffChatEnabled())) {
    throw new AppError(
      403,
      "Office staff chat is not enabled",
      "CHAT_DISABLED",
    );
  }
}

export async function assertStudentAdminChatEnabled() {
  if (!(await settingsService.isStudentAdminChatEnabled())) {
    throw new AppError(
      403,
      "Student–admin chat is not enabled",
      "CHAT_DISABLED",
    );
  }
}

export async function assertOfficeTeacherChatEnabled() {
  if (!(await settingsService.isOfficeTeacherChatEnabled())) {
    throw new AppError(
      403,
      "Office staff–teacher chat is not enabled",
      "CHAT_DISABLED",
    );
  }
}

export async function assertOfficeAdminChatEnabled() {
  if (!(await settingsService.isOfficeAdminChatEnabled())) {
    throw new AppError(
      403,
      "Office staff–admin chat is not enabled",
      "CHAT_DISABLED",
    );
  }
}

export async function assertTeacherAdminChatEnabled() {
  if (!(await settingsService.isTeacherAdminChatEnabled())) {
    throw new AppError(
      403,
      "Teacher–admin chat is not enabled",
      "CHAT_DISABLED",
    );
  }
}

/** Active Super Admins (school-wide). */
export async function listSuperAdmins(): Promise<ChatPeer[]> {
  return listAdminsForGuardian("");
}

/** Active students a Super Admin may message. */
export async function listStudentsForSuperAdmin(
  _adminUserId: string,
): Promise<ChatPeer[]> {
  const rows = (await AppDataSource.query(
    `
    SELECT
      u.id AS "userId",
      u."fullName" AS "fullName",
      u."preferredName" AS "preferredName",
      u.role AS "role",
      '[]'::json AS "sharedClasses"
    FROM users u
    WHERE u.role = $1
      AND u.status = $2
    ORDER BY COALESCE(NULLIF(u."preferredName", ''), u."fullName") ASC
    `,
    [UserRole.STUDENT, UserStatus.ACTIVE],
  )) as Array<{
    userId: string;
    fullName: string;
    preferredName: string | null;
    role: UserRole;
    sharedClasses: ChatPeer["sharedClasses"] | string;
  }>;

  return rows.map((row) => ({
    userId: row.userId,
    fullName: row.fullName,
    preferredName: row.preferredName,
    role: row.role,
    sharedClasses: parseSharedClasses(row.sharedClasses),
    subtitle: "Student",
  }));
}

/** Active teachers (STAFF) office staff may message school-wide. */
export async function listTeachersForOfficeStaff(
  _officeStaffUserId: string,
): Promise<ChatPeer[]> {
  const rows = (await AppDataSource.query(
    `
    SELECT
      u.id AS "userId",
      u."fullName" AS "fullName",
      u."preferredName" AS "preferredName",
      u.role AS "role",
      '[]'::json AS "sharedClasses"
    FROM users u
    WHERE u.role = $1
      AND u.status = $2
    ORDER BY COALESCE(NULLIF(u."preferredName", ''), u."fullName") ASC
    `,
    [UserRole.STAFF, UserStatus.ACTIVE],
  )) as Array<{
    userId: string;
    fullName: string;
    preferredName: string | null;
    role: UserRole;
    sharedClasses: ChatPeer["sharedClasses"] | string;
  }>;

  return rows.map((row) => ({
    userId: row.userId,
    fullName: row.fullName,
    preferredName: row.preferredName,
    role: row.role,
    sharedClasses: parseSharedClasses(row.sharedClasses),
    subtitle: "Teacher",
  }));
}

/** Active office staff a teacher may message school-wide. */
export async function listOfficeStaffForTeacher(
  _teacherUserId: string,
): Promise<ChatPeer[]> {
  const rows = (await AppDataSource.query(
    `
    SELECT
      u.id AS "userId",
      u."fullName" AS "fullName",
      u."preferredName" AS "preferredName",
      u.role AS "role",
      '[]'::json AS "sharedClasses"
    FROM users u
    WHERE u.role = $1
      AND u.status = $2
    ORDER BY COALESCE(NULLIF(u."preferredName", ''), u."fullName") ASC
    `,
    [UserRole.OFFICE_STAFF, UserStatus.ACTIVE],
  )) as Array<{
    userId: string;
    fullName: string;
    preferredName: string | null;
    role: UserRole;
    sharedClasses: ChatPeer["sharedClasses"] | string;
  }>;

  return rows.map((row) => ({
    userId: row.userId,
    fullName: row.fullName,
    preferredName: row.preferredName,
    role: row.role,
    sharedClasses: parseSharedClasses(row.sharedClasses),
    subtitle: "Office Staff",
  }));
}

/** Active office staff a Super Admin may message. */
export async function listOfficeStaffForSuperAdmin(
  _adminUserId: string,
): Promise<ChatPeer[]> {
  return listOfficeStaffForTeacher("");
}

/** Active Super Admins an office staff member may message. */
export async function listSuperAdminsForOfficeStaff(
  _officeStaffUserId: string,
): Promise<ChatPeer[]> {
  return listSuperAdmins();
}

/** Active teachers a Super Admin may message. */
export async function listTeachersForSuperAdmin(
  _adminUserId: string,
): Promise<ChatPeer[]> {
  return listTeachersForOfficeStaff("");
}

/** Active Super Admins a teacher may message. */
export async function listSuperAdminsForTeacher(
  _teacherUserId: string,
): Promise<ChatPeer[]> {
  return listSuperAdmins();
}

/** Active Super Admins a student may message. */
export async function listSuperAdminsForStudent(
  _studentUserId: string,
): Promise<ChatPeer[]> {
  return listSuperAdmins();
}

/** Active guardians an admin may message. */
export async function listGuardiansForAdmin(
  _adminUserId: string,
): Promise<ChatPeer[]> {
  const rows = (await AppDataSource.query(
    `
    SELECT
      u.id AS "userId",
      u."fullName" AS "fullName",
      u."preferredName" AS "preferredName",
      u.role AS "role",
      '[]'::json AS "sharedClasses",
      COALESCE(
        (
          SELECT string_agg(DISTINCT student_name, ', ')
          FROM (
            SELECT COALESCE(NULLIF(su."preferredName", ''), su."fullName", st."fullName") AS student_name
            FROM guardian_students gs
            INNER JOIN students st ON st.id = gs."studentId"
            LEFT JOIN users su ON su.id = st."userId"
            WHERE gs."guardianId" = u.id
          ) names
        ),
        ''
      ) AS "studentNames"
    FROM users u
    WHERE u.role = $1
      AND u.status = $2
    ORDER BY COALESCE(NULLIF(u."preferredName", ''), u."fullName") ASC
    `,
    [UserRole.GUARDIAN, UserStatus.ACTIVE],
  )) as Array<{
    userId: string;
    fullName: string;
    preferredName: string | null;
    role: UserRole;
    sharedClasses: ChatPeer["sharedClasses"] | string;
    studentNames: string;
  }>;

  return rows.map((row) => ({
    userId: row.userId,
    fullName: row.fullName,
    preferredName: row.preferredName,
    role: row.role,
    sharedClasses: parseSharedClasses(row.sharedClasses),
    subtitle: row.studentNames
      ? `Parent of ${row.studentNames}`
      : "Guardian",
  }));
}

export async function assertCanChat(
  actorUserId: string,
  actorRole: UserRole,
  peerUserId: string,
): Promise<ChatPair> {
  if (actorUserId === peerUserId) {
    throw new AppError(
      400,
      "You cannot message yourself",
      "CHAT_SELF_MESSAGE",
    );
  }

  if (actorRole === UserRole.STUDENT) {
    const teachers = await listTeachersForStudent(actorUserId);
    if (teachers.some((peer) => peer.userId === peerUserId)) {
      return {
        kind: "STUDENT_TEACHER",
        studentUserId: actorUserId,
        teacherUserId: peerUserId,
        guardianUserId: null,
        peerTeacherUserId: null,
        adminUserId: null,
      };
    }

    if (await settingsService.isStudentAdminChatEnabled()) {
      const admins = await listSuperAdminsForStudent(actorUserId);
      if (admins.some((peer) => peer.userId === peerUserId)) {
        return {
          kind: "STUDENT_ADMIN",
          studentUserId: actorUserId,
          teacherUserId: null,
          guardianUserId: null,
          peerTeacherUserId: null,
          adminUserId: peerUserId,
        };
      }
    }

    throw new AppError(
      403,
      "You can only message teachers from your classes or Super Admins",
      "CHAT_FORBIDDEN",
    );
  }

  if (actorRole === UserRole.GUARDIAN) {
    if (await settingsService.isGuardianTeacherChatEnabled()) {
      const teachers = await listTeachersForGuardian(actorUserId);
      if (teachers.some((peer) => peer.userId === peerUserId)) {
        return {
          kind: "GUARDIAN_TEACHER",
          studentUserId: null,
          teacherUserId: peerUserId,
          guardianUserId: actorUserId,
          peerTeacherUserId: null,
          adminUserId: null,
        };
      }
    }

    if (await settingsService.isGuardianAdminChatEnabled()) {
      const admins = await listAdminsForGuardian(actorUserId);
      if (admins.some((peer) => peer.userId === peerUserId)) {
        return {
          kind: "GUARDIAN_ADMIN",
          studentUserId: null,
          teacherUserId: null,
          guardianUserId: actorUserId,
          peerTeacherUserId: null,
          adminUserId: peerUserId,
        };
      }
    }

    throw new AppError(
      403,
      "You can only message teachers of your linked students or Super Admins",
      "CHAT_FORBIDDEN",
    );
  }

  if (actorRole === UserRole.STAFF) {
    const students = await listStudentsForTeacher(actorUserId);
    if (students.some((peer) => peer.userId === peerUserId)) {
      return {
        kind: "STUDENT_TEACHER",
        studentUserId: peerUserId,
        teacherUserId: actorUserId,
        guardianUserId: null,
        peerTeacherUserId: null,
        adminUserId: null,
      };
    }

    if (await settingsService.isGuardianTeacherChatEnabled()) {
      const guardians = await listGuardiansForTeacher(actorUserId);
      if (guardians.some((peer) => peer.userId === peerUserId)) {
        return {
          kind: "GUARDIAN_TEACHER",
          studentUserId: null,
          teacherUserId: actorUserId,
          guardianUserId: peerUserId,
          peerTeacherUserId: null,
          adminUserId: null,
        };
      }
    }

    if (await settingsService.isTeacherTeacherChatEnabled()) {
      const teachers = await listTeachersForTeacher(actorUserId);
      if (teachers.some((peer) => peer.userId === peerUserId)) {
        const ordered = orderedTeacherPair(actorUserId, peerUserId);
        return {
          kind: "TEACHER_TEACHER",
          studentUserId: null,
          teacherUserId: ordered.teacherUserId,
          guardianUserId: null,
          peerTeacherUserId: ordered.peerTeacherUserId,
          adminUserId: null,
        };
      }
    }

    if (await settingsService.isOfficeTeacherChatEnabled()) {
      const officeStaff = await listOfficeStaffForTeacher(actorUserId);
      if (officeStaff.some((peer) => peer.userId === peerUserId)) {
        return {
          kind: "OFFICE_TEACHER",
          studentUserId: null,
          teacherUserId: actorUserId,
          guardianUserId: null,
          peerTeacherUserId: null,
          adminUserId: peerUserId,
        };
      }
    }

    if (await settingsService.isTeacherAdminChatEnabled()) {
      const admins = await listSuperAdminsForTeacher(actorUserId);
      if (admins.some((peer) => peer.userId === peerUserId)) {
        return {
          kind: "TEACHER_ADMIN",
          studentUserId: null,
          teacherUserId: actorUserId,
          guardianUserId: null,
          peerTeacherUserId: null,
          adminUserId: peerUserId,
        };
      }
    }

    throw new AppError(
      403,
      "You can only message students, guardians, teachers, office staff, or Super Admins linked to your school",
      "CHAT_FORBIDDEN",
    );
  }

  if (isAdminChatRole(actorRole)) {
    if (await settingsService.isGuardianAdminChatEnabled()) {
      const guardians = await listGuardiansForAdmin(actorUserId);
      if (guardians.some((peer) => peer.userId === peerUserId)) {
        return {
          kind: "GUARDIAN_ADMIN",
          studentUserId: null,
          teacherUserId: null,
          guardianUserId: peerUserId,
          peerTeacherUserId: null,
          adminUserId: actorUserId,
        };
      }
    }

    if (await settingsService.isStudentAdminChatEnabled()) {
      const students = await listStudentsForSuperAdmin(actorUserId);
      if (students.some((peer) => peer.userId === peerUserId)) {
        return {
          kind: "STUDENT_ADMIN",
          studentUserId: peerUserId,
          teacherUserId: null,
          guardianUserId: null,
          peerTeacherUserId: null,
          adminUserId: actorUserId,
        };
      }
    }

    if (await settingsService.isTeacherAdminChatEnabled()) {
      const teachers = await listTeachersForSuperAdmin(actorUserId);
      if (teachers.some((peer) => peer.userId === peerUserId)) {
        return {
          kind: "TEACHER_ADMIN",
          studentUserId: null,
          teacherUserId: peerUserId,
          guardianUserId: null,
          peerTeacherUserId: null,
          adminUserId: actorUserId,
        };
      }
    }

    if (await settingsService.isOfficeAdminChatEnabled()) {
      const officeStaff = await listOfficeStaffForSuperAdmin(actorUserId);
      if (officeStaff.some((peer) => peer.userId === peerUserId)) {
        return {
          kind: "OFFICE_ADMIN",
          studentUserId: null,
          teacherUserId: peerUserId,
          guardianUserId: null,
          peerTeacherUserId: null,
          adminUserId: actorUserId,
        };
      }
    }

    throw new AppError(
      403,
      "You can only message guardians, students, teachers, or office staff",
      "CHAT_FORBIDDEN",
    );
  }

  if (actorRole === UserRole.OFFICE_STAFF) {
    if (await settingsService.isOfficeStaffChatEnabled()) {
      const peers = await listOfficeStaffForOfficeStaff(actorUserId);
      if (peers.some((peer) => peer.userId === peerUserId)) {
        const ordered = orderedTeacherPair(actorUserId, peerUserId);
        return {
          kind: "OFFICE_STAFF_OFFICE_STAFF",
          studentUserId: null,
          teacherUserId: ordered.teacherUserId,
          guardianUserId: null,
          peerTeacherUserId: ordered.peerTeacherUserId,
          adminUserId: null,
        };
      }
    }

    if (await settingsService.isOfficeTeacherChatEnabled()) {
      const teachers = await listTeachersForOfficeStaff(actorUserId);
      if (teachers.some((peer) => peer.userId === peerUserId)) {
        return {
          kind: "OFFICE_TEACHER",
          studentUserId: null,
          teacherUserId: peerUserId,
          guardianUserId: null,
          peerTeacherUserId: null,
          adminUserId: actorUserId,
        };
      }
    }

    if (await settingsService.isOfficeAdminChatEnabled()) {
      const admins = await listSuperAdminsForOfficeStaff(actorUserId);
      if (admins.some((peer) => peer.userId === peerUserId)) {
        return {
          kind: "OFFICE_ADMIN",
          studentUserId: null,
          teacherUserId: actorUserId,
          guardianUserId: null,
          peerTeacherUserId: null,
          adminUserId: peerUserId,
        };
      }
    }

    throw new AppError(
      403,
      "You can only message other office staff, teachers, or Super Admins",
      "CHAT_FORBIDDEN",
    );
  }

  throw new AppError(403, "Chat is not available for this role", "CHAT_FORBIDDEN");
}

export function isGuardianTeacherConversation(conversation: {
  kind?: ChatConversationKind | string | null;
  guardianUserId?: string | null;
  teacherUserId?: string | null;
  adminUserId?: string | null;
}) {
  if (conversation.kind === "GUARDIAN_TEACHER") return true;
  if (
    conversation.kind === "GUARDIAN_ADMIN" ||
    conversation.kind === "STUDENT_ADMIN" ||
    conversation.kind === "OFFICE_TEACHER" ||
    conversation.kind === "OFFICE_ADMIN" ||
    conversation.kind === "TEACHER_ADMIN"
  ) {
    return false;
  }
  return (
    Boolean(conversation.guardianUserId) &&
    Boolean(conversation.teacherUserId) &&
    !conversation.adminUserId
  );
}

export function isTeacherTeacherConversation(conversation: {
  kind?: ChatConversationKind | string | null;
  peerTeacherUserId?: string | null;
}) {
  if (conversation.kind === "OFFICE_STAFF_OFFICE_STAFF") return false;
  return (
    conversation.kind === "TEACHER_TEACHER" ||
    Boolean(conversation.peerTeacherUserId)
  );
}

export function isOfficeStaffPeerConversation(conversation: {
  kind?: ChatConversationKind | string | null;
}) {
  return conversation.kind === "OFFICE_STAFF_OFFICE_STAFF";
}

export function isGuardianAdminConversation(conversation: {
  kind?: ChatConversationKind | string | null;
  adminUserId?: string | null;
  guardianUserId?: string | null;
  teacherUserId?: string | null;
  studentUserId?: string | null;
}) {
  return (
    conversation.kind === "GUARDIAN_ADMIN" ||
    (Boolean(conversation.adminUserId) &&
      Boolean(conversation.guardianUserId) &&
      !conversation.teacherUserId &&
      !conversation.studentUserId)
  );
}

export function isStudentAdminConversation(conversation: {
  kind?: ChatConversationKind | string | null;
  adminUserId?: string | null;
  studentUserId?: string | null;
  guardianUserId?: string | null;
  teacherUserId?: string | null;
}) {
  return (
    conversation.kind === "STUDENT_ADMIN" ||
    (Boolean(conversation.adminUserId) &&
      Boolean(conversation.studentUserId) &&
      !conversation.guardianUserId &&
      !conversation.teacherUserId)
  );
}

export function isOfficeTeacherConversation(conversation: {
  kind?: ChatConversationKind | string | null;
}) {
  return conversation.kind === "OFFICE_TEACHER";
}

export function isOfficeAdminConversation(conversation: {
  kind?: ChatConversationKind | string | null;
}) {
  return conversation.kind === "OFFICE_ADMIN";
}

export function isTeacherAdminConversation(conversation: {
  kind?: ChatConversationKind | string | null;
}) {
  return conversation.kind === "TEACHER_ADMIN";
}

export function peerDisplayName(peer: {
  fullName: string;
  preferredName: string | null;
}) {
  return displayName(peer);
}
