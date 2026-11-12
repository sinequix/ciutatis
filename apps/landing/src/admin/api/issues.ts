import type {
  Approval,
  DocumentRevision,
  Issue,
  IssueAttachment,
  IssueComment,
  IssueDocument,
  IssueLabel,
  IssueRetryNowResponse,
  IssueTreeControlPreview,
  IssueTreeHold,
  IssueWorkProduct,
  UpsertIssueDocument,
} from "@paperclipai/shared";
import { api } from "./client";

export const issuesApi = {
  list: (
    companyId: string,
    filters?: {
      status?: string;
      projectId?: string;
      assigneeAgentId?: string;
      assigneeUserId?: string;
      touchedByUserId?: string;
      unreadForUserId?: string;
      labelId?: string;
      q?: string;
      parentId?: string;
      descendantOf?: string;
      originKind?: string;
      originKindPrefix?: string;
      originId?: string;
      participantAgentId?: string;
      workspaceId?: string;
      executionWorkspaceId?: string;
      includeRoutineExecutions?: boolean;
    },
  ) => {
    const params = new URLSearchParams();
    if (filters?.status) params.set("status", filters.status);
    if (filters?.projectId) params.set("projectId", filters.projectId);
    if (filters?.assigneeAgentId) params.set("assigneeAgentId", filters.assigneeAgentId);
    if (filters?.assigneeUserId) params.set("assigneeUserId", filters.assigneeUserId);
    if (filters?.touchedByUserId) params.set("touchedByUserId", filters.touchedByUserId);
    if (filters?.unreadForUserId) params.set("unreadForUserId", filters.unreadForUserId);
    if (filters?.labelId) params.set("labelId", filters.labelId);
    if (filters?.q) params.set("q", filters.q);
    if (filters?.parentId) params.set("parentId", filters.parentId);
    if (filters?.descendantOf) params.set("descendantOf", filters.descendantOf);
    if (filters?.originKind) params.set("originKind", filters.originKind);
    if (filters?.originKindPrefix) params.set("originKindPrefix", filters.originKindPrefix);
    if (filters?.originId) params.set("originId", filters.originId);
    if (filters?.participantAgentId) params.set("participantAgentId", filters.participantAgentId);
    if (filters?.workspaceId) params.set("workspaceId", filters.workspaceId);
    if (filters?.executionWorkspaceId) params.set("executionWorkspaceId", filters.executionWorkspaceId);
    if (filters?.includeRoutineExecutions !== undefined) {
      params.set("includeRoutineExecutions", String(filters.includeRoutineExecutions));
    }
    const qs = params.toString();
    return api.get<Issue[]>(`/companies/${companyId}/issues${qs ? `?${qs}` : ""}`);
  },
  listLabels: (companyId: string) => api.get<IssueLabel[]>(`/companies/${companyId}/labels`),
  createLabel: (companyId: string, data: { name: string; color: string }) =>
    api.post<IssueLabel>(`/companies/${companyId}/labels`, data),
  deleteLabel: (id: string) => api.delete<IssueLabel>(`/labels/${id}`),
  get: (id: string) => api.get<Issue>(`/issues/${id}`),
  markRead: (id: string) => api.post<{ id: string; lastReadAt: Date }>(`/issues/${id}/read`, {}),
  create: (companyId: string, data: Record<string, unknown>) =>
    api.post<Issue>(`/companies/${companyId}/issues`, data),
  update: (id: string, data: Record<string, unknown>) => api.patch<Issue>(`/issues/${id}`, data),
  remove: (id: string) => api.delete<Issue>(`/issues/${id}`),
  checkout: (id: string, agentId: string) =>
    api.post<Issue>(`/issues/${id}/checkout`, {
      agentId,
      expectedStatuses: ["todo", "backlog", "blocked"],
    }),
  release: (id: string) => api.post<Issue>(`/issues/${id}/release`, {}),
  listComments: (id: string) => api.get<IssueComment[]>(`/issues/${id}/comments`),
  addComment: (id: string, body: string, reopen?: boolean, interrupt?: boolean) =>
    api.post<IssueComment>(
      `/issues/${id}/comments`,
      {
        body,
        ...(reopen === undefined ? {} : { reopen }),
        ...(interrupt === undefined ? {} : { interrupt }),
      },
    ),
  listDocuments: (id: string) => api.get<IssueDocument[]>(`/issues/${id}/documents`),
  getDocument: (id: string, key: string) => api.get<IssueDocument>(`/issues/${id}/documents/${encodeURIComponent(key)}`),
  upsertDocument: (id: string, key: string, data: UpsertIssueDocument) =>
    api.put<IssueDocument>(`/issues/${id}/documents/${encodeURIComponent(key)}`, data),
  listDocumentRevisions: (id: string, key: string) =>
    api.get<DocumentRevision[]>(`/issues/${id}/documents/${encodeURIComponent(key)}/revisions`),
  deleteDocument: (id: string, key: string) =>
    api.delete<{ ok: true }>(`/issues/${id}/documents/${encodeURIComponent(key)}`),
  listAttachments: (id: string) => api.get<IssueAttachment[]>(`/issues/${id}/attachments`),
  uploadAttachment: (
    companyId: string,
    issueId: string,
    file: File,
    issueCommentId?: string | null,
  ) => {
    const form = new FormData();
    form.append("file", file);
    if (issueCommentId) {
      form.append("issueCommentId", issueCommentId);
    }
    return api.postForm<IssueAttachment>(`/companies/${companyId}/issues/${issueId}/attachments`, form);
  },
  deleteAttachment: (id: string) => api.delete<{ ok: true }>(`/attachments/${id}`),
  listApprovals: (id: string) => api.get<Approval[]>(`/issues/${id}/approvals`),
  linkApproval: (id: string, approvalId: string) =>
    api.post<Approval[]>(`/issues/${id}/approvals`, { approvalId }),
  unlinkApproval: (id: string, approvalId: string) =>
    api.delete<{ ok: true }>(`/issues/${id}/approvals/${approvalId}`),
  listWorkProducts: (id: string) => api.get<IssueWorkProduct[]>(`/issues/${id}/work-products`),
  createWorkProduct: (id: string, data: Record<string, unknown>) =>
    api.post<IssueWorkProduct>(`/issues/${id}/work-products`, data),
  updateWorkProduct: (id: string, data: Record<string, unknown>) =>
    api.patch<IssueWorkProduct>(`/work-products/${id}`, data),
  deleteWorkProduct: (id: string) => api.delete<IssueWorkProduct>(`/work-products/${id}`),
  retryScheduledRetryNow: (id: string) =>
    api.post<IssueRetryNowResponse>(`/issues/${id}/scheduled-retry/retry-now`, {}),
  previewTreeControl: (
    id: string,
    data: { mode: string; releasePolicy?: Record<string, unknown> | null },
  ) => api.post<IssueTreeControlPreview>(`/issues/${id}/tree-control/preview`, data),
  getTreeControlState: (id: string) =>
    api.get<{ activePauseHold: {
      holdId: string;
      rootIssueId: string;
      issueId: string;
      isRoot: boolean;
      mode: "pause";
      reason: string | null;
      releasePolicy: IssueTreeHold["releasePolicy"];
    } | null }>(`/issues/${id}/tree-control/state`),
  listTreeHolds: (id: string, filters?: { mode?: string }) => {
    const params = new URLSearchParams();
    if (filters?.mode) params.set("mode", filters.mode);
    const qs = params.toString();
    return api.get<IssueTreeHold[]>(`/issues/${id}/tree-holds${qs ? `?${qs}` : ""}`);
  },
  createTreeHold: (
    id: string,
    data: {
      mode: string;
      reason?: string | null;
      releasePolicy?: Record<string, unknown> | null;
      metadata?: Record<string, unknown> | null;
    },
  ) => api.post<{ hold: IssueTreeHold; preview?: IssueTreeControlPreview }>(`/issues/${id}/tree-holds`, data),
  releaseTreeHold: (
    id: string,
    holdId: string,
    data: { reason?: string | null; metadata?: Record<string, unknown> | null },
  ) => api.post<IssueTreeHold>(`/issues/${id}/tree-holds/${holdId}/release`, data),
};
