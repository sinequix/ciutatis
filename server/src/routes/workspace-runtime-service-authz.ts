export function assertExecutionWorkspaceCommandAccess(): void {
  return;
}

export function assertCanManageExecutionWorkspaceRuntimeServices(
  _db: unknown,
  _req: unknown,
  _options: {
    companyId: string;
    executionWorkspaceId: string;
    sourceIssueId: string | null;
  },
): void {
  return;
}

// Stub alias for upstream compatibility
export const assertCanManageProjectWorkspaceRuntimeServices = assertCanManageExecutionWorkspaceRuntimeServices;
