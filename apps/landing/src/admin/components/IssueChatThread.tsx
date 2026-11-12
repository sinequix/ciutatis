import { useMemo, useState } from "react";
import type { Agent, IssueCommentMetadata, IssueCommentMetadataRow, SuccessfulRunHandoffState } from "@paperclipai/shared";
import { Check, ChevronDown, Copy, Link2 } from "lucide-react";
import type { LiveRunForIssue } from "../api/heartbeats";
import type { IssueChatComment, IssueChatLinkedRun, IssueChatTranscriptEntry } from "../lib/issue-chat-messages";
import { buildIssueChatMessages } from "../lib/issue-chat-messages";
import type { IssueTimelineEvent } from "../lib/issue-timeline-events";
import { SUCCESSFUL_RUN_HANDOFF_REQUIRED_NOTICE_BODY } from "../lib/successful-run-handoff";

type IssueChatThreadProps = {
  comments: IssueChatComment[];
  linkedRuns?: IssueChatLinkedRun[];
  timelineEvents?: IssueTimelineEvent[];
  liveRuns?: LiveRunForIssue[];
  onAdd: (body: string) => Promise<void>;
  showComposer?: boolean;
  showJumpToLatest?: boolean;
  enableLiveTranscriptPolling?: boolean;
  agentMap?: Map<string, Agent>;
  currentUserId?: string | null;
  issueStatus?: string;
  successfulRunHandoff?: SuccessfulRunHandoffState | null;
  transcriptsByRunId?: Map<string, readonly IssueChatTranscriptEntry[]>;
  hasOutputForRun?: (runId: string) => boolean;
  issueWorkMode?: string;
  onWorkModeChange?: (workMode: string) => void;
  onStopRun?: (runId: string) => Promise<void>;
  stopRunLabel?: string;
  stoppingRunLabel?: string;
};

function isSystemNotice(comment: IssueChatComment) {
  return comment.authorType === "system" && comment.presentation?.kind === "system_notice";
}

function metadataText(row: IssueCommentMetadataRow) {
  return [
    row.label,
    row.text,
    row.code,
    row.value,
    row.identifier,
    row.title,
    row.name,
    row.runId,
  ].filter(Boolean).join(" ");
}

function MetadataDetails({ metadata }: { metadata: IssueCommentMetadata | null }) {
  if (!metadata?.sections?.length) return null;
  return (
    <div className="mt-2 space-y-2 text-xs text-muted-foreground">
      {metadata.sections.map((section, sectionIndex) => (
        <div key={sectionIndex}>
          {section.title ? <div className="font-medium text-foreground">{section.title}</div> : null}
          <div className="space-y-1">
            {section.rows.map((row, rowIndex) => (
              <div key={rowIndex}>{metadataText(row)}</div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function NoticeSource({
  comment,
  agentMap,
}: {
  comment: IssueChatComment;
  agentMap?: Map<string, Agent>;
}) {
  if (comment.runAgentId && comment.runId) {
    const name = agentMap?.get(comment.runAgentId)?.name ?? "Paperclip";
    return <a href={`/agents/${comment.runAgentId}/runs/${comment.runId}`}>{name}</a>;
  }
  return <span>Paperclip</span>;
}

function SystemNotice({
  comment,
  agentMap,
}: {
  comment: IssueChatComment;
  agentMap?: Map<string, Agent>;
}) {
  const [open, setOpen] = useState(comment.presentation?.detailsDefaultOpen === true);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedText, setCopiedText] = useState(false);
  const title = comment.presentation?.title || "System alert";
  const detailsId = `comment-${comment.id}-details`;

  async function copyText(value: string, mode: "link" | "text") {
    await navigator.clipboard?.writeText(value);
    if (mode === "link") {
      setCopiedLink(true);
      setCopiedText(false);
    } else {
      setCopiedText(true);
      setCopiedLink(false);
    }
  }

  return (
    <div id={`comment-${comment.id}`} data-message-role="system" className="rounded-md border border-border px-3 py-2">
      <div role="status" aria-label={title} className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground">from <NoticeSource comment={comment} agentMap={agentMap} /></span>
        <button
          type="button"
          aria-label="Copy link to system notice"
          className="ml-auto inline-flex items-center gap-1"
          onClick={() => copyText(`${window.location.href.split("#")[0]}#comment-${comment.id}`, "link")}
        >
          {copiedLink ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          aria-label="Copy system notice"
          className="inline-flex items-center gap-1"
          onClick={() => copyText(comment.body, "text")}
        >
          {copiedText ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      <p className="mt-1 text-sm">{comment.body}</p>
      {comment.metadata ? (
        <>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={detailsId}
            className="mt-2 text-xs text-muted-foreground"
            onClick={() => setOpen((current) => !current)}
          >
            Details
          </button>
          {open ? (
            <div id={detailsId}>
              <MetadataDetails metadata={comment.metadata} />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function StaleDispositionWarning({ comment }: { comment: IssueChatComment }) {
  const [open, setOpen] = useState(false);
  const detailsId = `stale-disposition-warning-${comment.id}`;

  return (
    <div data-testid="stale-disposition-warning" className="rounded-md border border-border px-2 py-1 text-sm">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailsId}
        className="flex w-full items-center gap-2 py-0.5 text-left"
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true" className="size-6 rounded-full bg-muted" />
        <span>Stale disposition warning</span>
        <span className="ml-auto text-xs text-muted-foreground">
          <span data-testid="stale-disposition-warning-time">
            {new Date(comment.createdAt).toLocaleDateString()}
          </span>
        </span>
        <ChevronDown className="h-4 w-4" />
      </button>
      <div id={detailsId} hidden={!open} className="mt-2 text-xs text-muted-foreground">
        <MetadataDetails metadata={comment.metadata} />
      </div>
    </div>
  );
}

export function IssueChatThread({
  comments,
  linkedRuns = [],
  timelineEvents = [],
  liveRuns = [],
  onAdd,
  showComposer = true,
  agentMap,
  currentUserId,
  issueStatus,
  successfulRunHandoff,
}: IssueChatThreadProps) {
  const messages = useMemo(() => buildIssueChatMessages({
    comments,
    linkedRuns,
    timelineEvents,
    liveRuns,
    agentMap,
    currentUserId,
  }), [agentMap, comments, currentUserId, linkedRuns, liveRuns, timelineEvents]);

  const showStaleDisposition = (comment: IssueChatComment) =>
    isSystemNotice(comment)
    && comment.body === SUCCESSFUL_RUN_HANDOFF_REQUIRED_NOTICE_BODY
    && (issueStatus === "done" || issueStatus === "cancelled" || successfulRunHandoff?.required === false);

  return (
    <div className="space-y-3">
      {messages.map((message) => {
        if (message.kind === "comment") {
          const { comment } = message;
          if (showStaleDisposition(comment)) {
            return <StaleDispositionWarning key={comment.id} comment={comment} />;
          }
          if (isSystemNotice(comment)) {
            return <SystemNotice key={comment.id} comment={comment} agentMap={agentMap} />;
          }
          const role = comment.authorType === "agent" ? "assistant" : comment.authorType;
          return (
            <div key={comment.id} id={`comment-${comment.id}`} data-message-role={role} className="rounded-md border border-border px-3 py-2">
              {comment.body}
            </div>
          );
        }
        return (
          <div key={message.id} data-message-role={message.role} className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
            {message.kind === "timeline" ? "Activity update" : "Run update"}
          </div>
        );
      })}
      {showComposer ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void onAdd("");
          }}
        >
          <textarea aria-label="Issue chat editor" className="w-full rounded-md border border-border bg-background p-2" />
        </form>
      ) : null}
    </div>
  );
}
