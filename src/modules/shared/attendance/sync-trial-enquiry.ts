import { AttendanceStatus } from "../../../entities/index.js";
import { logger } from "../../../config/logger.js";

const ATTENDED_STATUSES = new Set<AttendanceStatus>([
  AttendanceStatus.PRESENT,
  AttendanceStatus.LATE,
]);

export async function syncTrialEnquiryOnAttendance(params: {
  studentUserId: string;
  status: AttendanceStatus;
  termId?: string | null;
  actorId?: string | null;
}) {
  if (!params.studentUserId || !ATTENDED_STATUSES.has(params.status)) return;

  try {
    const { adminEnquiriesService } = await import(
      "../../admin/enquiries/admin-enquiries.service.js"
    );
    await adminEnquiriesService.markTrialAttendedForStudent(
      params.studentUserId,
      {
        termId: params.termId ?? undefined,
        actorId: params.actorId ?? null,
      },
    );
  } catch (error) {
    logger.error(
      { error, studentUserId: params.studentUserId },
      "Failed to move enquiry to trial attended after class attendance",
    );
  }
}
