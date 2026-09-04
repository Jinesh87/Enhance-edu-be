export type SessionLessonLabelRow = {
  id?: string;
  startAt: string;
  /** Top-level fields used by slim calendar rows (no nested class). */
  subject?: string | null;
  termId?: string | null;
  lesson?: string | null;
  /** Legacy nested class — still supported for full session rows. */
  class?: {
    subject?: string | null;
    termId?: string | null;
    term?: string | null;
    lesson?: string | null;
    [key: string]: unknown;
  } | null;
};

function sessionLessonGroupKey(row: SessionLessonLabelRow): string {
  const subject = (
    row.subject || row.class?.subject || "General"
  )
    .trim()
    .toLowerCase();
  const term = (
    row.termId || row.class?.termId || row.class?.term || ""
  )
    .toString()
    .trim()
    .toLowerCase();
  return `${subject}|${term}`;
}

export function applySequentialLessonLabels<T extends SessionLessonLabelRow>(
  sessions: T[],
): T[] {
  const sorted = [...sessions].sort(
    (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
  );
  const lessonCounters = new Map<string, number>();
  return sorted.map((row) => {
    const groupKey = sessionLessonGroupKey(row);
    const lessonNumber = (lessonCounters.get(groupKey) ?? 0) + 1;
    lessonCounters.set(groupKey, lessonNumber);
    const label = `Lesson ${lessonNumber}`;
    if (row.class) {
      return {
        ...row,
        lesson: label,
        class: { ...row.class, lesson: label },
      };
    }
    return { ...row, lesson: label };
  });
}
