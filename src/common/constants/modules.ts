export const ADMIN_MODULE_IDS = [
  "dashboard",
  "enquiries",
  "enrolments",
  "classes",
  "subjects",
  "terms",
  "attendance",
  "messages",
  "reports",
  "tasks",
  "people",
  "settings",
  "change-history",
] as const;

export type AdminModuleId = (typeof ADMIN_MODULE_IDS)[number];

export const ADMIN_MODULES: {
  id: AdminModuleId;
  label: string;
  path: string;
}[] = [
  { id: "dashboard", label: "Dashboard", path: "/admin" },
  { id: "enquiries", label: "Enquiries", path: "/admin/enquiries" },
  { id: "enrolments", label: "Enrolments", path: "/admin/enrolments" },
  { id: "classes", label: "Classes", path: "/admin/classes" },
  { id: "subjects", label: "Subjects", path: "/admin/subjects" },
  { id: "terms", label: "Terms", path: "/admin/terms" },
  { id: "attendance", label: "Attendance", path: "/admin/attendance" },
  { id: "messages", label: "Messages", path: "/admin/messages" },
  { id: "reports", label: "Reports", path: "/admin/reports" },
  { id: "tasks", label: "Tasks", path: "/admin/tasks" },
  { id: "people", label: "People", path: "/admin/people" },
  { id: "settings", label: "Settings", path: "/admin/messaging-settings" },
  { id: "change-history", label: "Change history", path: "/admin/change-history" },
];

const MODULE_SET = new Set<string>(ADMIN_MODULE_IDS);

export function sanitizeModulePermissions(
  values?: string[] | null,
): string[] {
  if (!values?.length) return [];
  return [...new Set(values.filter((value) => MODULE_SET.has(value)))];
}
