export type { ToolResult } from "./tool-helpers.js";

export {
  getAttendanceSummary,
  getLowAttendanceClasses,
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
  getPendingHomeworkSummary,
  getAcademicPerformanceSummary,
  getEnquiryPipelineSummary,
  getPendingEnrollmentSummary,
  getOpenTasksSummary,
} from "./tools/ops.tools.js";

export {
  getInstitutionSettingsSummary,
  getAiUsageSummary,
  getDraftContext,
} from "./tools/settings.tools.js";

