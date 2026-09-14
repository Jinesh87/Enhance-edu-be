import type { AdminModuleId } from "../../../common/constants/modules.js";
import { UserRole } from "../../../common/constants/roles.js";
import {
  canUseAdminAiModule,
  type AdminAiActor,
} from "./authorization.js";
import { formatModuleAccessGuidance } from "./module-intent.js";
import { REPORT_MODULE } from "./reports/report.types.js";

export { formatModuleAccessGuidance as formatAllowedModulesForPrompt };

/**
 * Modules required to *offer* a tool to the model (AND semantics when multiple).
 * Empty array = available to any Admin AI actor (e.g. personal memory).
 * Execution still calls assertAdminAiModule inside each tool.
 */
export const ADMIN_AI_TOOL_MODULES: Record<string, AdminModuleId[]> = {
  getAttendanceSummary: ["attendance"],
  getLowAttendanceClasses: ["attendance", "classes"],
  getLowAttendanceStudents: ["attendance"],
  getTodayTimetable: ["classes"],
  getTermClassSchedule: ["classes"],
  searchTeachers: ["classes"],
  searchStudents: ["enrolments"],
  searchClasses: ["classes"],
  listSubjects: ["subjects"],
  listTerms: ["terms"],
  searchEnrolments: ["enrolments"],
  searchEnquiries: ["enquiries"],
  listOpenTasks: ["tasks"],
  listAssessments: ["classes"],
  listSessions: ["classes"],
  searchPeople: ["people"],
  listClassrooms: ["settings"],
  listSyllabi: ["syllabus"],
  searchChangeHistory: ["change-history"],
  getInstitutionSettingsSummary: ["settings"],
  getAiUsageSummary: ["settings"],
  getTodaysAbsences: ["attendance"],
  getClassRoster: ["classes"],
  getPendingHomeworkSummary: ["classes"],
  listHomework: ["classes"],
  getOpsSnapshot: ["classes"],
  getAcademicPerformanceSummary: ["classes"],
  getEnquiryPipelineSummary: ["enquiries"],
  getPendingEnrollmentSummary: ["enrolments"],
  getOpenTasksSummary: ["tasks"],
  searchAuthorizedSyllabusDocuments: ["syllabus"],
  getHolidays: ["settings"],
  getDraftContext: ["settings"],
  saveUserMemory: [],
  previewReport: ["reports"],
  updateReportPreview: ["reports"],
  generateReport: ["reports"],
  createCommunicationDraft: ["messages"],
  updateCommunicationDraft: ["messages"],
  previewAudience: ["messages"],
  getCommunicationDraft: ["messages"],
};

const REPORT_DATA_MODULES = [
  ...new Set(Object.values(REPORT_MODULE)),
] as AdminModuleId[];

function actorHasAllModules(
  actor: AdminAiActor,
  moduleIds: AdminModuleId[],
): boolean {
  if (moduleIds.length === 0) return true;
  return moduleIds.every((moduleId) => canUseAdminAiModule(actor, moduleId));
}

function actorHasAnyModule(
  actor: AdminAiActor,
  moduleIds: AdminModuleId[],
): boolean {
  if (moduleIds.length === 0) return true;
  return moduleIds.some((moduleId) => canUseAdminAiModule(actor, moduleId));
}

function canUseReportTools(actor: AdminAiActor): boolean {
  if (actor.role === UserRole.SUPER_ADMIN) return true;
  return (
    canUseAdminAiModule(actor, "reports") ||
    actorHasAnyModule(actor, REPORT_DATA_MODULES)
  );
}

export function canUseAdminAiTool(
  actor: AdminAiActor,
  toolName: string,
): boolean {
  if (toolName === "getAiUsageSummary") {
    return actor.role === UserRole.SUPER_ADMIN;
  }

  if (
    toolName === "previewReport" ||
    toolName === "updateReportPreview" ||
    toolName === "generateReport"
  ) {
    return canUseReportTools(actor);
  }

  const required = ADMIN_AI_TOOL_MODULES[toolName];
  if (required === undefined) {
    return actor.role === UserRole.SUPER_ADMIN;
  }
  return actorHasAllModules(actor, required);
}
