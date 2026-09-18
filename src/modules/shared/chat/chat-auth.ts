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
      kind: "GUARDIAN_ADMIN";
      studentUserId: null;
      teacherUserId: null;
      guardianUserId: string;
      peerTeacherUserId: null;
      adminUserId: string;
    };

export function isAdminChatRole(role: UserRole) {
  return role === UserRole.SUPER_ADMIN;
}

/** Canonical order so teacher–teacher pairs are unique regardless of who opens. */
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
    if (!teachers.some((peer) => peer.userId === peerUserId)) {
      throw new AppError(
        403,
        "You can only message teachers from your classes",
        "CHAT_FORBIDDEN",
      );
    }
    return {
      kind: "STUDENT_TEACHER",
      studentUserId: actorUserId,
      teacherUserId: peerUserId,
      guardianUserId: null,
      peerTeacherUserId: null,
      adminUserId: null,
    };
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

    throw new AppError(
      403,
      "You can only message students, guardians, or teachers linked to your classes",
      "CHAT_FORBIDDEN",
    );
  }

  if (isAdminChatRole(actorRole)) {
    await assertGuardianAdminChatEnabled();
    const guardians = await listGuardiansForAdmin(actorUserId);
    if (!guardians.some((peer) => peer.userId === peerUserId)) {
      throw new AppError(
        403,
        "You can only message guardians",
        "CHAT_FORBIDDEN",
      );
    }
    return {
      kind: "GUARDIAN_ADMIN",
      studentUserId: null,
      teacherUserId: null,
      guardianUserId: peerUserId,
      peerTeacherUserId: null,
      adminUserId: actorUserId,
    };
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
  if (conversation.kind === "GUARDIAN_ADMIN") return false;
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
  return (
    conversation.kind === "TEACHER_TEACHER" ||
    Boolean(conversation.peerTeacherUserId)
  );
}

export function isGuardianAdminConversation(conversation: {
  kind?: ChatConversationKind | string | null;
  adminUserId?: string | null;
}) {
  return (
    conversation.kind === "GUARDIAN_ADMIN" ||
    Boolean(conversation.adminUserId)
  );
}

export function peerDisplayName(peer: {
  fullName: string;
  preferredName: string | null;
}) {
  return displayName(peer);
}
