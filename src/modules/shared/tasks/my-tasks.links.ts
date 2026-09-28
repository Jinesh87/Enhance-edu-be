import { UserRole } from "../../../common/constants/roles.js";

export function myTasksHref(role: UserRole, taskId?: string): string {
  const base = role === UserRole.STAFF ? "/tutor/tasks" : "/admin/my-tasks";
  return taskId ? `${base}?id=${taskId}` : base;
}
