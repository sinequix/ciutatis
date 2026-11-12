import type { Project, ProjectWorkspace, WorkspaceOperation } from "@paperclipai/shared";
import { api } from "./client";
import type { WorkspaceRuntimeControlAction, WorkspaceRuntimeControlTarget } from "./execution-workspaces";

function projectPath(companyId: string, id: string, suffix = "") {
  return `/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(id)}${suffix}`;
}

export const projectsApi = {
  list: (companyId: string) => api.get<Project[]>(`/companies/${companyId}/projects`),
  get: (id: string, companyId: string) => api.get<Project>(projectPath(companyId, id)),
  create: (companyId: string, data: Record<string, unknown>) =>
    api.post<Project>(`/companies/${companyId}/projects`, data),
  update: (id: string, data: Record<string, unknown>, companyId: string) =>
    api.patch<Project>(projectPath(companyId, id), data),
  listWorkspaces: (projectId: string, companyId: string) =>
    api.get<ProjectWorkspace[]>(projectPath(companyId, projectId, "/workspaces")),
  createWorkspace: (projectId: string, data: Record<string, unknown>, companyId: string) =>
    api.post<ProjectWorkspace>(projectPath(companyId, projectId, "/workspaces"), data),
  updateWorkspace: (projectId: string, workspaceId: string, data: Record<string, unknown>, companyId: string) =>
    api.patch<ProjectWorkspace>(
      projectPath(companyId, projectId, `/workspaces/${encodeURIComponent(workspaceId)}`),
      data,
    ),
  controlWorkspaceRuntimeServices: (
    projectId: string,
    workspaceId: string,
    action: WorkspaceRuntimeControlAction,
    _companyId: string,
    target: WorkspaceRuntimeControlTarget = {},
  ) =>
    api.post<{ workspace: ProjectWorkspace; operation: WorkspaceOperation }>(
      `/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/runtime-services/${action}`,
      target,
    ),
  removeWorkspace: (projectId: string, workspaceId: string, companyId: string) =>
    api.delete<ProjectWorkspace>(projectPath(companyId, projectId, `/workspaces/${encodeURIComponent(workspaceId)}`)),
  remove: (id: string, companyId: string) => api.delete<Project>(projectPath(companyId, id)),
};
