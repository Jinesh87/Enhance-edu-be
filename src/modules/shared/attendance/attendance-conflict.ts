/**
 * Optimistic concurrency for multi-device edits.
 * Option C: missing baseUpdatedAt + content differs → conflict (not LWW).
 * With base: conflict only when server is newer and content differs.
 */
export function isOptimisticConflict(input: {
  clientBaseUpdatedAt: string | null | undefined;
  serverUpdatedAt: Date;
  contentDiffers: boolean;
}): boolean {
  if (!input.contentDiffers) return false;

  const base = input.clientBaseUpdatedAt?.trim();
  if (!base) return true;

  const clientMs = Date.parse(base);
  if (Number.isNaN(clientMs)) return true;

  return input.serverUpdatedAt.getTime() > clientMs;
}

export function isAttendanceConflict(input: {
  clientBaseUpdatedAt: string | null | undefined;
  serverUpdatedAt: Date;
  serverStatus: string;
  nextStatus: string;
}): boolean {
  return isOptimisticConflict({
    clientBaseUpdatedAt: input.clientBaseUpdatedAt,
    serverUpdatedAt: input.serverUpdatedAt,
    contentDiffers: input.serverStatus !== input.nextStatus,
  });
}

export function homeworkGradeContentDiffers(
  server: {
    marks: number | null;
    maxMarks: number | null;
    feedback: string | null;
    isCompleted: boolean;
  },
  next: {
    marks?: number | null;
    maxMarks?: number | null;
    feedback?: string | null;
    isCompleted?: boolean;
  },
): boolean {
  if (next.marks !== undefined) {
    const a = server.marks;
    const b = next.marks;
    if (a !== b && !(a == null && b == null)) {
      if (Number(a) !== Number(b)) return true;
    }
  }
  if (next.maxMarks !== undefined) {
    const a = server.maxMarks;
    const b = next.maxMarks;
    if (Number(a ?? 100) !== Number(b ?? 100)) return true;
  }
  if (next.feedback !== undefined) {
    const a = (server.feedback ?? "").trim();
    const b = (next.feedback ?? "").trim();
    if (a !== b) return true;
  }
  if (next.isCompleted !== undefined) {
    if (Boolean(server.isCompleted) !== Boolean(next.isCompleted)) return true;
  }
  return false;
}

export function sessionLessonContentDiffers(
  server: {
    title: string;
    description: string | null;
    objectives: string | null;
    notes: string | null;
  },
  next: {
    title: string;
    description?: string | null;
    objectives?: string | null;
    notes?: string | null;
  },
): boolean {
  if (server.title.trim() !== next.title.trim()) return true;
  const norm = (v: string | null | undefined) => (v ?? "").trim();
  if (norm(server.description) !== norm(next.description)) return true;
  if (norm(server.objectives) !== norm(next.objectives)) return true;
  if (norm(server.notes) !== norm(next.notes)) return true;
  return false;
}
