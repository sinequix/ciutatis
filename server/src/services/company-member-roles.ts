// Stub file for upstream features not in Ciutatis
// Company member roles service

export type HumanRole = "owner" | "admin" | "operator" | "viewer";

export function normalizeHumanRole(
  role: string | null | undefined,
  defaultRole: HumanRole = "operator",
): HumanRole {
  if (role === "owner" || role === "admin" || role === "operator" || role === "viewer") {
    return role;
  }
  return defaultRole;
}

export function grantsForHumanRole(
  role: HumanRole,
): Array<{ permissionKey: string; scope: Record<string, unknown> | null }> {
  // Ciutatis: simplified grants - board has full access
  return [];
}

export function resolveHumanInviteRole(
  defaultsPayload: Record<string, unknown> | null | undefined,
): HumanRole | null {
  if (!defaultsPayload || typeof defaultsPayload !== "object") return null;
  const human = defaultsPayload.human as Record<string, unknown> | undefined;
  if (!human || typeof human !== "object") return null;
  const role = human.role as string | undefined;
  if (role === "owner" || role === "admin" || role === "operator" || role === "viewer") {
    return role;
  }
  return null;
}

export function getCompanyMemberRoles(): unknown[] {
  return [];
}
