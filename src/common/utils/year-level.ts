/** Parse "Year 8", "8", or 8 into a numeric year level. */
export function yearLevelNumber(
  value?: string | number | null,
): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const match = String(value).trim().match(/(\d+)/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

export function termYearLevelNumber(term?: {
  yearLevel?: { name?: string | null; sequence?: number | null } | null;
} | null): number | null {
  if (!term?.yearLevel) return null;
  if (
    term.yearLevel.sequence != null &&
    Number.isFinite(term.yearLevel.sequence)
  ) {
    return term.yearLevel.sequence;
  }
  return yearLevelNumber(term.yearLevel.name);
}

/** True when either side is unknown, or both resolve to the same year. */
export function yearLevelsCompatible(
  studentYear?: number | null,
  termYear?: number | null,
): boolean {
  if (studentYear == null || termYear == null) return true;
  return studentYear === termYear;
}
