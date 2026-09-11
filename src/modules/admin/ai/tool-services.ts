export type { ToolResult } from "./tool-helpers.js";

export {
  getAttendanceSummary,
  getLowAttendanceClasses,
  getLowAttendanceStudents,
  getTodayTimetable,
  getTermClassSchedule,
  getTodaysAbsences,
  getClassRoster,
  getHolidays,
} from "./tools/attendance.tools.js";

export {
  searchTeachers,
  searchStudents,
  searchClasses,
  listSubjects,
  listTerms,
  searchPeople,
  listClassrooms,
  listSyllabi,
} from "./tools/catalogue.tools.js";

export {
  searchEnrolments,
  searchEnquiries,
  listOpenTasks,
  listAssessments,
  listSessions,
  searchChangeHistory,
  listHomework,
  getPendingHomeworkSummary,
  getAcademicPerformanceSummary,
  getEnquiryPipelineSummary,
  getPendingEnrollmentSummary,
  getOpenTasksSummary,
  getOpsSnapshot,
} from "./tools/ops.tools.js";

export {
  getInstitutionSettingsSummary,
  getAiUsageSummary,
  getDraftContext,
} from "./tools/settings.tools.js";

export { saveUserMemory } from "./tools/memory.tools.js";

export {
  generateReport,
  previewReport,
  updateReportPreview,
} from "./tools/report.tools.js";

export {
  createCommunicationDraft,
  updateCommunicationDraft,
  previewAudience,
  getCommunicationDraft,
} from "./communications/communication.tools.js";

