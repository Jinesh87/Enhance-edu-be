import type { ClassStudent, Session } from "../../../entities/index.js";

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

export interface TimeWindow {
  startAt: Date | string | number;
  endAt: Date | string | number;
}

export function isSessionOverlappingWindows(
  session: Pick<Session, "startAt" | "endAt">,
  windows: TimeWindow[],
): boolean {
  if (windows.length === 0) return false;
  const sessionStart = new Date(session.startAt).getTime();
  const sessionEnd = new Date(session.endAt).getTime();
  return windows.some((w) => {
    const wStart = new Date(w.startAt).getTime();
    const wEnd = new Date(w.endAt).getTime();
    return sessionStart < wEnd && wStart < sessionEnd;
  });
}
