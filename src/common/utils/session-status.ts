export type SessionStatus = "UPCOMING" | "LIVE" | "ENDED" | "SCHEDULED";

export function sessionStatus(
  startAt: Date,
  endAt: Date,
  now = Date.now(),
): SessionStatus {
  const start = startAt.getTime();
  const end = endAt.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "SCHEDULED";
  if (now < start) return "UPCOMING";
  if (now <= end) return "LIVE";
  return "ENDED";
}

/** True once the occurrence has started (live or ended). Invalid times stay locked. */
export function sessionHasStarted(startAt: Date, now = Date.now()): boolean {
  const start = startAt.getTime();
  if (!Number.isFinite(start)) return true;
  return now >= start;
}
