import type {
  HeartbeatRun,
  HeartbeatRunEvent,
  InstanceSchedulerHeartbeatAgent,
  WorkspaceOperation,
} from "@paperclipai/shared";
import { api } from "./client";

export interface ActiveRunForIssue extends HeartbeatRun {
  agentId: string;
  agentName: string;
  adapterType: string;
  lastOutputBytes?: number | null;
}

export interface LiveRunForIssue {
  id: string;
  status: string;
  invocationSource: string;
  triggerDetail: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  agentId: string;
  agentName: string;
  adapterType: string;
  issueId?: string | null;
  logBytes?: number | null;
  lastOutputBytes?: number | null;
}

export type LiveRunsForCompanyOptions = {
  minCount?: number;
  limit?: number;
};

export interface WatchdogDecisionInput {
  runId: string;
  issueId?: string;
  decision: "continue_waiting" | "stop_run" | "mark_failed" | string;
  reason?: string | null;
}

function liveRunsForCompanyQuery(options?: number | LiveRunsForCompanyOptions) {
  const searchParams = new URLSearchParams();
  if (typeof options === "number") {
    searchParams.set("minCount", String(options));
  } else if (options) {
    if (typeof options.minCount === "number") searchParams.set("minCount", String(options.minCount));
    if (typeof options.limit === "number") searchParams.set("limit", String(options.limit));
  }
  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

export interface HeartbeatRunListOptions {
  summary?: boolean;
}

export const heartbeatsApi = {
  list: (companyId: string, agentId?: string, limit?: number, options: HeartbeatRunListOptions = {}) => {
    const searchParams = new URLSearchParams();
    if (agentId) searchParams.set("agentId", agentId);
    if (limit) searchParams.set("limit", String(limit));
    if (options.summary) searchParams.set("summary", "true");
    const qs = searchParams.toString();
    return api.get<HeartbeatRun[]>(`/companies/${companyId}/heartbeat-runs${qs ? `?${qs}` : ""}`);
  },
  get: (runId: string) => api.get<HeartbeatRun>(`/heartbeat-runs/${runId}`),
  events: (runId: string, afterSeq = 0, limit = 200) =>
    api.get<HeartbeatRunEvent[]>(
      `/heartbeat-runs/${runId}/events?afterSeq=${encodeURIComponent(String(afterSeq))}&limit=${encodeURIComponent(String(limit))}`,
    ),
  log: (runId: string, offset = 0, limitBytes = 256000) =>
    api.get<{ runId: string; store: string; logRef: string; content: string; nextOffset?: number }>(
      `/heartbeat-runs/${runId}/log?offset=${encodeURIComponent(String(offset))}&limitBytes=${encodeURIComponent(String(limitBytes))}`,
    ),
  workspaceOperations: (runId: string) =>
    api.get<WorkspaceOperation[]>(`/heartbeat-runs/${runId}/workspace-operations`),
  workspaceOperationLog: (operationId: string, offset = 0, limitBytes = 256000) =>
    api.get<{ operationId: string; store: string; logRef: string; content: string; nextOffset?: number }>(
      `/workspace-operations/${operationId}/log?offset=${encodeURIComponent(String(offset))}&limitBytes=${encodeURIComponent(String(limitBytes))}`,
    ),
  cancel: (runId: string) => api.post<void>(`/heartbeat-runs/${runId}/cancel`, {}),
  liveRunsForIssue: (issueId: string) =>
    api.get<LiveRunForIssue[]>(`/issues/${issueId}/live-runs`),
  activeRunForIssue: (issueId: string) =>
    api.get<ActiveRunForIssue | null>(`/issues/${issueId}/active-run`),
  recordWatchdogDecision: (input: WatchdogDecisionInput) =>
    api.post<void>(`/heartbeat-runs/${encodeURIComponent(input.runId)}/watchdog-decision`, input),
  liveRunsForCompany: (companyId: string, options?: number | LiveRunsForCompanyOptions) =>
    api.get<LiveRunForIssue[]>(`/companies/${companyId}/live-runs${liveRunsForCompanyQuery(options)}`),
  listInstanceSchedulerAgents: () =>
    api.get<InstanceSchedulerHeartbeatAgent[]>("/instance/scheduler-heartbeats"),
};
