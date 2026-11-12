import type { Db } from "@paperclipai/db";
import type { WorkspaceRuntimeService } from "@paperclipai/shared";

export async function listCurrentRuntimeServicesForExecutionWorkspaces(
  _db: Db,
  _companyId: string,
  _executionWorkspaceIds: string[],
): Promise<Map<string, WorkspaceRuntimeService[]>> {
  return new Map();
}

export async function listCurrentRuntimeServicesForProjectWorkspaces(
  _db: Db,
  _companyId: string,
  _projectWorkspaceIds: string[],
): Promise<Map<string, WorkspaceRuntimeService[]>> {
  return new Map();
}
