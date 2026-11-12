import type { Agent, IssueCommentMetadata, IssueCommentPresentation } from "@paperclipai/shared";
import type { LiveRunForIssue } from "../api/heartbeats";
import type { IssueTimelineEvent } from "./issue-timeline-events";

export type IssueChatAuthorType = "user" | "agent" | "system";

export interface IssueChatComment {
  id: string;
  companyId: string;
  issueId: string;
  authorType: IssueChatAuthorType;
  authorAgentId: string | null;
  authorUserId: string | null;
  body: string;
  presentation: IssueCommentPresentation | null;
  metadata: (IssueCommentMetadata & Record<string, unknown>) | null;
  runId?: string | null;
  runAgentId?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface IssueChatLinkedRun {
  runId: string;
  status: string;
  agentId: string;
  agentName: string;
  adapterType: string;
  createdAt: Date | string;
  startedAt: Date | string | null;
  finishedAt: Date | string | null;
  hasStoredOutput?: boolean;
}

export type IssueChatTranscriptEntry =
  | { kind: "thinking"; ts?: string; text: string }
  | { kind: "assistant"; ts?: string; text: string }
  | { kind: "tool_call"; ts?: string; name: string; toolUseId?: string; input?: unknown }
  | { kind: "tool_result"; ts?: string; toolUseId?: string; content: string; isError?: boolean };

export type IssueChatMessage =
  | { id: string; role: "user" | "assistant" | "system"; kind: "comment"; comment: IssueChatComment; createdAt: Date | string }
  | { id: string; role: "system"; kind: "timeline"; event: IssueTimelineEvent; createdAt: Date | string }
  | { id: string; role: "assistant" | "system"; kind: "run"; run: IssueChatLinkedRun | LiveRunForIssue; createdAt: Date | string };

export function buildIssueChatMessages({
  comments,
  timelineEvents = [],
  linkedRuns = [],
  liveRuns = [],
}: {
  comments: readonly IssueChatComment[];
  timelineEvents?: readonly IssueTimelineEvent[];
  linkedRuns?: readonly IssueChatLinkedRun[];
  liveRuns?: readonly LiveRunForIssue[];
  agentMap?: ReadonlyMap<string, Agent>;
  currentUserId?: string | null;
  transcriptsByRunId?: ReadonlyMap<string, readonly IssueChatTranscriptEntry[]>;
  hasOutputForRun?: (runId: string) => boolean;
}): IssueChatMessage[] {
  const rows: IssueChatMessage[] = [
    ...comments.map((comment) => ({
      id: comment.id,
      role: comment.authorType === "agent" ? "assistant" as const : comment.authorType,
      kind: "comment" as const,
      comment,
      createdAt: comment.createdAt,
    })),
    ...timelineEvents.map((event) => ({
      id: event.id,
      role: "system" as const,
      kind: "timeline" as const,
      event,
      createdAt: event.createdAt,
    })),
    ...linkedRuns.map((run) => ({
      id: run.runId,
      role: run.status === "running" || run.status === "queued" ? "assistant" as const : "system" as const,
      kind: "run" as const,
      run,
      createdAt: run.startedAt ?? run.createdAt,
    })),
    ...liveRuns.map((run) => ({
      id: run.id,
      role: "assistant" as const,
      kind: "run" as const,
      run,
      createdAt: run.startedAt ?? run.createdAt,
    })),
  ];

  return rows.sort((left, right) =>
    new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );
}
