export enum EnrollmentStatus {
  ACTIVE = "ACTIVE",
  /** Guardian invited; student profile not created until they accept. */
  AWAITING_GUARDIAN = "AWAITING_GUARDIAN",
}

export enum PendingEnrollmentStatus {
  PENDING = "PENDING",
  FULFILLED = "FULFILLED",
  CANCELLED = "CANCELLED",
}
