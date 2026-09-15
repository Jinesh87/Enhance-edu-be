import { AppDataSource } from "../../../config/data-source.js";
import { AppError } from "../../../common/errors/AppError.js";
import { UserRole, UserStatus } from "../../../common/constants/roles.js";

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
};

function displayName(peer: {
  fullName: string;
  preferredName: string | null;
}) {
  return peer.preferredName?.trim() || peer.fullName;
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
    sharedClasses: Array.isArray(row.sharedClasses)
      ? row.sharedClasses
      : (JSON.parse(String(row.sharedClasses)) as ChatPeer["sharedClasses"]),
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
    sharedClasses: Array.isArray(row.sharedClasses)
      ? row.sharedClasses
      : (JSON.parse(String(row.sharedClasses)) as ChatPeer["sharedClasses"]),
  }));
}

export async function assertCanChat(
  actorUserId: string,
  actorRole: UserRole,
  peerUserId: string,
) {
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
    return { studentUserId: actorUserId, teacherUserId: peerUserId };
  }

  if (actorRole === UserRole.STAFF) {
    const students = await listStudentsForTeacher(actorUserId);
    if (!students.some((peer) => peer.userId === peerUserId)) {
      throw new AppError(
        403,
        "You can only message students in your classes",
        "CHAT_FORBIDDEN",
      );
    }
    return { studentUserId: peerUserId, teacherUserId: actorUserId };
  }

  throw new AppError(403, "Chat is not available for this role", "CHAT_FORBIDDEN");
}

export function peerDisplayName(peer: {
  fullName: string;
  preferredName: string | null;
}) {
  return displayName(peer);
}
