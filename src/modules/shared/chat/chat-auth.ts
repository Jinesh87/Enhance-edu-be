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
    }
  | {
      kind: "GUARDIAN_TEACHER";
      studentUserId: null;
      teacherUserId: string;
      guardianUserId: string;
    };

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
        c.subject AS "subject"
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
      ) AS "studentNames"
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

export async function assertGuardianTeacherChatEnabled() {
  if (!(await settingsService.isGuardianTeacherChatEnabled())) {
    throw new AppError(
      403,
      "Guardian–teacher chat is not enabled",
      "CHAT_DISABLED",
    );
  }
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
    };
  }

  if (actorRole === UserRole.GUARDIAN) {
    await assertGuardianTeacherChatEnabled();
    const teachers = await listTeachersForGuardian(actorUserId);
    if (!teachers.some((peer) => peer.userId === peerUserId)) {
      throw new AppError(
        403,
        "You can only message teachers of your linked students",
        "CHAT_FORBIDDEN",
      );
    }
    return {
      kind: "GUARDIAN_TEACHER",
      studentUserId: null,
      teacherUserId: peerUserId,
      guardianUserId: actorUserId,
    };
  }

  if (actorRole === UserRole.STAFF) {
    const students = await listStudentsForTeacher(actorUserId);
    if (students.some((peer) => peer.userId === peerUserId)) {
      return {
        kind: "STUDENT_TEACHER",
        studentUserId: peerUserId,
        teacherUserId: actorUserId,
        guardianUserId: null,
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
        };
      }
    }

    throw new AppError(
      403,
      "You can only message students in your classes",
      "CHAT_FORBIDDEN",
    );
  }

  throw new AppError(403, "Chat is not available for this role", "CHAT_FORBIDDEN");
}

export function isGuardianTeacherConversation(conversation: {
  kind?: ChatConversationKind | string | null;
  guardianUserId?: string | null;
}) {
  return (
    conversation.kind === "GUARDIAN_TEACHER" ||
    Boolean(conversation.guardianUserId)
  );
}

export function peerDisplayName(peer: {
  fullName: string;
  preferredName: string | null;
}) {
  return displayName(peer);
}
