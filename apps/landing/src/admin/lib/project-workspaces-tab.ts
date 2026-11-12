import type { ExecutionWorkspace, Issue, Project, ProjectWorkspace, WorkspaceRuntimeService } from "@paperclipai/shared";

export type ProjectWorkspaceSummaryKind = "project_workspace" | "execution_workspace";

export interface ProjectWorkspaceSummary {
  key: string;
  kind: ProjectWorkspaceSummaryKind;
  workspaceId: string;
  workspaceName: string;
  sourceType: string;
  cwd: string | null;
  repoUrl: string | null;
  repoRef: string | null;
  runtimeConfig: Record<string, unknown> | null;
  runtimeServices: WorkspaceRuntimeService[];
  runningServiceCount: number;
  executionWorkspaceId: string | null;
  executionWorkspaceName: string | null;
  executionWorkspaceStatus: ExecutionWorkspace["status"] | null;
  issueId: string | null;
  detailHref: string | null;
  canStartServices: boolean;
  canRunJobs: boolean;
  lastUpdatedAt: Date;
}

function asDate(value: Date | string | null | undefined): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string") return new Date(value);
  return new Date(0);
}

function runtimeServicesFor(projectWorkspace: ProjectWorkspace, executionWorkspaces: ExecutionWorkspace[]) {
  const fromWorkspace = projectWorkspace.runtimeServices ?? [];
  const fromExecutions = executionWorkspaces
    .filter((workspace) => workspace.projectWorkspaceId === projectWorkspace.id)
    .flatMap((workspace) => workspace.runtimeServices ?? []);
  return [...fromWorkspace, ...fromExecutions];
}

function hasCommands(runtimeConfig: Record<string, unknown> | null, keys: string[]) {
  if (!runtimeConfig) return false;
  return keys.some((key) => Array.isArray(runtimeConfig[key]) && (runtimeConfig[key] as unknown[]).length > 0);
}

export function buildProjectWorkspaceSummaries(input: {
  project: Project;
  issues?: Issue[];
  executionWorkspaces?: ExecutionWorkspace[];
}): ProjectWorkspaceSummary[] {
  const executionWorkspaces = input.executionWorkspaces ?? [];
  const issuesByExecutionWorkspaceId = new Map<string, Issue>();
  for (const issue of input.issues ?? []) {
    if (issue.executionWorkspaceId) issuesByExecutionWorkspaceId.set(issue.executionWorkspaceId, issue);
  }

  const summaries: ProjectWorkspaceSummary[] = input.project.workspaces.map((workspace) => {
    const executions = executionWorkspaces.filter((entry) => entry.projectWorkspaceId === workspace.id);
    const latestExecution = executions.sort((a, b) => asDate(b.updatedAt).getTime() - asDate(a.updatedAt).getTime())[0] ?? null;
    const services = runtimeServicesFor(workspace, executions);
    const runtimeConfig = workspace.runtimeConfig ?? null;
    return {
      key: `project:${workspace.id}`,
      kind: "project_workspace",
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      sourceType: workspace.sourceType,
      cwd: workspace.cwd,
      repoUrl: workspace.repoUrl,
      repoRef: workspace.repoRef ?? workspace.defaultRef,
      runtimeConfig,
      runtimeServices: services,
      runningServiceCount: services.filter((service) => service.status === "running" || service.status === "starting").length,
      executionWorkspaceId: latestExecution?.id ?? null,
      executionWorkspaceName: latestExecution?.name ?? null,
      executionWorkspaceStatus: latestExecution?.status ?? null,
      issueId: latestExecution?.id ? issuesByExecutionWorkspaceId.get(latestExecution.id)?.id ?? null : null,
      detailHref: latestExecution ? `/execution-workspaces/${latestExecution.id}` : null,
      canStartServices: hasCommands(runtimeConfig, ["services", "serviceCommands"]),
      canRunJobs: hasCommands(runtimeConfig, ["jobs", "commands", "tasks"]),
      lastUpdatedAt: asDate(latestExecution?.updatedAt ?? workspace.updatedAt),
    };
  });

  const projectWorkspaceIds = new Set(input.project.workspaces.map((workspace) => workspace.id));
  for (const workspace of executionWorkspaces) {
    if (workspace.projectWorkspaceId && projectWorkspaceIds.has(workspace.projectWorkspaceId)) continue;
    const services = workspace.runtimeServices ?? [];
    const runtimeConfig = workspace.config?.workspaceRuntime && typeof workspace.config.workspaceRuntime === "object"
      ? workspace.config.workspaceRuntime as Record<string, unknown>
      : workspace.config ?? null;
    summaries.push({
      key: `execution:${workspace.id}`,
      kind: "execution_workspace",
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      sourceType: workspace.strategyType,
      cwd: workspace.cwd,
      repoUrl: workspace.repoUrl,
      repoRef: workspace.baseRef,
      runtimeConfig,
      runtimeServices: services,
      runningServiceCount: services.filter((service) => service.status === "running" || service.status === "starting").length,
      executionWorkspaceId: workspace.id,
      executionWorkspaceName: workspace.name,
      executionWorkspaceStatus: workspace.status,
      issueId: issuesByExecutionWorkspaceId.get(workspace.id)?.id ?? workspace.sourceIssueId,
      detailHref: `/execution-workspaces/${workspace.id}`,
      canStartServices: hasCommands(runtimeConfig, ["services", "serviceCommands"]),
      canRunJobs: hasCommands(runtimeConfig, ["jobs", "commands", "tasks"]),
      lastUpdatedAt: asDate(workspace.updatedAt),
    });
  }

  return summaries.sort((a, b) => b.runningServiceCount - a.runningServiceCount || b.lastUpdatedAt.getTime() - a.lastUpdatedAt.getTime());
}
