import type { ClassStudent, Session } from "../../../entities/index.js";

/**
 * Class attendance accountability starts at class roster join time
 * (`class_students.createdAt`). A student is accountable for a session only
 * when the session had not already ended before they joined.
 */
export function isStudentAccountableForSession(
  session: Pick<Session, "endAt">,
  joinedAt: Date,
): boolean {
  return session.endAt.getTime() > joinedAt.getTime();
}

export function buildClassJoinAtMap(
  enrolments: Array<Pick<ClassStudent, "classId" | "createdAt">>,
): Map<string, Date> {
  const joinAtByClassId = new Map<string, Date>();
  for (const row of enrolments) {
    const existing = joinAtByClassId.get(row.classId);
    if (!existing || row.createdAt.getTime() < existing.getTime()) {
      joinAtByClassId.set(row.classId, row.createdAt);
    }
  }
  return joinAtByClassId;
}
