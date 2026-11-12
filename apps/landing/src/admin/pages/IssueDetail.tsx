import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Agent, Issue, IssueTreeControlPreview, IssueTreeHold } from "@paperclipai/shared";
import { useParams } from "@/lib/router";
import { issuesApi } from "../api/issues";
import { agentsApi } from "../api/agents";
import { useCompany } from "../context/CompanyContext";
import { useToastActions } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { StatusIcon } from "../components/StatusIcon";
import { IssueChatThread } from "../components/IssueChatThread";
import { IssuesList } from "../components/IssuesList";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type TreeMode = "pause" | "resume" | "restore" | "cancel";

function issuePathId(issue: Issue | null | undefined, fallback: string) {
  return issue?.identifier ?? fallback;
}

function isLeafPause(activePauseHold: { releasePolicy?: { note?: string | null } | null } | null | undefined) {
  return activePauseHold?.releasePolicy?.note === "leaf_pause";
}

function isFullSubtreePause(activePauseHold: { releasePolicy?: { note?: string | null } | null } | null | undefined) {
  return activePauseHold?.releasePolicy?.note === "full_pause";
}

function previewIssueLabel(issue: IssueTreeControlPreview["issues"][number]) {
  if (issue.skipped && issue.skipReason === "terminal_status") return `${issue.title} Complete`;
  return issue.title;
}

export function IssueDetail() {
  const { issueId = "" } = useParams<{ issueId: string }>();
  const { selectedCompanyId } = useCompany();
  const { pushToast } = useToastActions();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<TreeMode | null>(null);
  const [preview, setPreview] = useState<IssueTreeControlPreview | null>(null);
  const [wakeAgents, setWakeAgents] = useState(true);
  const [cancelConfirmed, setCancelConfirmed] = useState(false);

  const issueQuery = useQuery({
    queryKey: queryKeys.issues.detail(issueId),
    queryFn: () => issuesApi.get(issueId),
    enabled: Boolean(issueId),
  });
  const issue = issueQuery.data ?? null;
  const companyId = issue?.companyId ?? selectedCompanyId ?? "";
  const pathId = issuePathId(issue, issueId);

  const childIssuesQuery = useQuery({
    queryKey: ["issue-detail", pathId, "descendants"],
    queryFn: () => issuesApi.list(companyId, { descendantOf: issue!.id }),
    enabled: Boolean(companyId && issue?.id),
  });
  const treeControlQuery = useQuery({
    queryKey: ["issue-detail", pathId, "tree-control"],
    queryFn: () => issuesApi.getTreeControlState(pathId),
    enabled: Boolean(issue),
  });
  const holdsQuery = useQuery({
    queryKey: ["issue-detail", pathId, "tree-holds"],
    queryFn: () => issuesApi.listTreeHolds(pathId),
    enabled: Boolean(issue),
  });
  const cancelHoldsQuery = useQuery({
    queryKey: ["issue-detail", pathId, "tree-holds", "cancel"],
    queryFn: () => issuesApi.listTreeHolds(pathId, { mode: "cancel" }),
    enabled: Boolean(issue),
  });
  const attachmentsQuery = useQuery({
    queryKey: queryKeys.issues.attachments(issueId),
    queryFn: () => issuesApi.listAttachments(issueId),
    enabled: Boolean(issueId),
  });
  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(companyId || "__none__"),
    queryFn: () => agentsApi.list(companyId),
    enabled: Boolean(companyId),
  });

  const agentsById = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const agent of agentsQuery.data ?? []) map.set(agent.id, agent);
    return map;
  }, [agentsQuery.data]);
  const activePauseHold = treeControlQuery.data?.activePauseHold ?? null;
  const activeHoldRecord = (holdsQuery.data ?? []).find((hold: IssueTreeHold) => hold.id === activePauseHold?.holdId) ?? null;
  const childIssues = childIssuesQuery.data ?? [];
  const childBadgeById = useMemo(() => {
    const badges = new Map<string, string>();
    if (activePauseHold) {
      for (const child of childIssues) badges.set(child.id, "Paused");
    }
    return badges;
  }, [activePauseHold, childIssues]);

  const previewControl = useMutation({
    mutationFn: (mode: TreeMode) =>
      issuesApi.previewTreeControl(pathId, {
        mode,
        releasePolicy: { strategy: "manual" },
      }),
    onSuccess: (nextPreview, mode) => {
      setPreview(nextPreview);
      setDialogMode(mode);
      setWakeAgents(mode === "resume");
      setCancelConfirmed(false);
    },
  });

  const createHold = useMutation({
    mutationFn: (input: { mode: TreeMode; source?: "active-run"; runId?: string }) => {
      if (input.mode === "pause" && input.source === "active-run") {
        return issuesApi.createTreeHold(pathId, {
          mode: "pause",
          reason: "Paused from active run controls.",
          releasePolicy: { strategy: "manual", note: "leaf_pause" },
          metadata: { source: "issue_active_run_control", runId: input.runId ?? null },
        });
      }
      if (input.mode === "restore") {
        return issuesApi.createTreeHold(pathId, {
          mode: "restore",
          reason: null,
          releasePolicy: { strategy: "manual" },
          metadata: { wakeAgents: false },
        });
      }
      return issuesApi.createTreeHold(pathId, {
        mode: input.mode,
        reason: null,
        releasePolicy: { strategy: "manual", note: "full_pause" },
      });
    },
  });

  const releaseHold = useMutation({
    mutationFn: async () => {
      if (!activePauseHold) throw new Error("No active pause hold");
      return issuesApi.releaseTreeHold(pathId, activePauseHold.holdId, {
        reason: null,
        metadata: { wakeAgents },
      });
    },
    onSuccess: async (hold: IssueTreeHold) => {
      await treeControlQuery.refetch();
      await queryClient.invalidateQueries({ queryKey: ["issue-detail", pathId, "tree-holds"] });
      pushToast({
        title: isLeafPause(activePauseHold) ? "Work resumed" : "Subtree resumed",
        body: hold.releaseReason ?? "Ready to continue",
        tone: "success",
      });
      setDialogMode(null);
      setPreview(null);
    },
  });

  const updateWorkMode = useMutation({
    mutationFn: (workMode: string) => issuesApi.update(pathId, { workMode }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId) });
    },
  });

  if (issueQuery.isLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-3">
          <div className="h-3 w-64 bg-accent/75 rounded-md animate-pulse" />
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 bg-accent/75 rounded-md animate-pulse" />
            <div className="h-6 w-6 bg-accent/75 rounded-md animate-pulse" />
            <div className="h-7 w-48 bg-accent/75 rounded-md animate-pulse" />
          </div>
          <div className="h-4 w-40 bg-accent/75 rounded-md animate-pulse" />
        </div>
        <div className="space-y-3">
          <div className="h-10 w-full bg-accent/75 rounded-md animate-pulse" />
          <div className="h-32 w-full bg-accent/75 rounded-md animate-pulse" />
        </div>
      </div>
    );
  }
  if (issueQuery.error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="bg-muted/50 p-4 mb-4 rounded-md">
          <span className="text-2xl">⚠️</span>
        </div>
        <p className="text-sm text-destructive mb-2">
          {(issueQuery.error as Error).message}
        </p>
        <button
          onClick={() => issueQuery.refetch()}
          className="text-sm text-primary hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }
  if (!issue) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="bg-muted/50 p-4 mb-4 rounded-md">
          <span className="text-2xl">🔍</span>
        </div>
        <p className="text-sm text-muted-foreground">Issue not found.</p>
      </div>
    );
  }

  const issueWorkMode = (issue.workMode as string | undefined) ?? "standard";
  const isPlanning = issueWorkMode === "planning";
  const showSubtreePauseBanner = isFullSubtreePause(activePauseHold);
  const showLeafPauseBanner = isLeafPause(activePauseHold);
  const pauseActionLabel = childIssues.length > 0 ? "Pause subtree..." : "Pause work...";
  const restoreCount = preview?.issues.filter((entry) => !entry.skipped).length ?? 0;
  const affectedIssueCount = preview?.totals.affectedIssues ?? preview?.issues.filter((entry) => !entry.skipped).length ?? 0;

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <StatusIcon status={issue.status} blockerAttention={issue.blockerAttention as never} />
          <h1>{issue.title}</h1>
          {isPlanning ? <span>Planning</span> : null}
        </div>
        <button
          type="button"
          aria-label="More issue actions"
          onClick={() => setMenuOpen((current) => !current)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") setMenuOpen(true);
          }}
        >
          More
        </button>
        {(menuOpen || true) ? (
          <div>
            <button type="button" onClick={() => previewControl.mutate("pause")}>
              {pauseActionLabel}
            </button>
            <button type="button" onClick={() => previewControl.mutate("cancel")}>
              Cancel subtree...
            </button>
            {(cancelHoldsQuery.data ?? []).length > 0 ? (
              <button type="button" onClick={() => previewControl.mutate("restore")}>
                Restore subtree...
              </button>
            ) : null}
          </div>
        ) : null}
      </header>

      {showSubtreePauseBanner ? (
        <section>
          <p>Subtree pause is active.</p>
          <button type="button" onClick={() => previewControl.mutate("resume")}>
            Resume subtree
          </button>
        </section>
      ) : null}

      {showLeafPauseBanner ? (
        <section>
          <p>Paused by board.</p>
          <p>{issue.status}</p>
          <button type="button" onClick={() => previewControl.mutate("resume")}>
            Resume work
          </button>
        </section>
      ) : null}

      <IssueChatThread
        comments={[]}
        linkedRuns={[]}
        timelineEvents={[]}
        liveRuns={[]}
        onAdd={async () => undefined}
        showComposer
        issueWorkMode={issueWorkMode}
        onWorkModeChange={(workMode: string) => updateWorkMode.mutate(workMode)}
        stopRunLabel="Pause work"
        stoppingRunLabel="Pausing..."
        onStopRun={async (runId: string) => {
          await createHold.mutateAsync({ mode: "pause", source: "active-run", runId });
        }}
      />

      {attachmentsQuery.data?.length ? (
        <div>
          {attachmentsQuery.data.map((attachment) => (
            <span key={attachment.id}>{attachment.originalFilename ?? attachment.contentPath}</span>
          ))}
        </div>
      ) : null}

      <IssuesList
        issues={childIssues}
        issueBadgeById={childBadgeById}
        showProgressSummary={Boolean(activePauseHold)}
      />

      <Dialog open={dialogMode !== null}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-hidden flex-col">
          <DialogHeader>
            <DialogTitle>
              {dialogMode === "resume"
                ? isLeafPause(activePauseHold) ? "Resume work" : "Resume subtree"
                : dialogMode === "restore"
                  ? "Restore subtree"
                  : dialogMode === "cancel"
                    ? "Cancel subtree"
                    : "Pause subtree"}
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto overscroll-contain">
            {dialogMode === "restore" ? (
              <p>Restore issues cancelled by this subtree operation so work can resume.</p>
            ) : null}
            {dialogMode === "cancel" ? <label>Reason (optional)</label> : null}
            {dialogMode === "cancel" ? (
              <label>
                <input
                  type="checkbox"
                  checked={cancelConfirmed}
                  onChange={(event) => setCancelConfirmed(event.currentTarget.checked)}
                />
                Confirm cancellation
              </label>
            ) : null}
            {dialogMode === "resume" ? (
              <label>
                <input
                  type="checkbox"
                  checked={wakeAgents}
                  onChange={(event) => setWakeAgents(event.currentTarget.checked)}
                />
                Wake assignees
              </label>
            ) : null}
            {preview?.affectedAgents?.map((entry) => (
              <span key={entry.agentId}>{agentsById.get(entry.agentId)?.name ?? entry.agentId}</span>
            ))}
            {preview?.issues.map((entry) => (
              <div key={entry.id}>{previewIssueLabel(entry)}</div>
            ))}
          </div>
          <DialogFooter className="border-t bg-background">
            <button type="button" onClick={() => setDialogMode(null)}>Close</button>
            {dialogMode === "resume" ? (
              <button type="button" onClick={() => releaseHold.mutate()}>
                {isLeafPause(activePauseHold) ? "Resume work" : "Resume subtree"}
              </button>
            ) : dialogMode === "restore" ? (
              <button type="button" onClick={() => createHold.mutate({ mode: "restore" })}>
                Restore {restoreCount} issues
              </button>
            ) : dialogMode === "cancel" ? (
              <button
                type="button"
                disabled={!cancelConfirmed}
                onClick={() => createHold.mutate({ mode: "cancel" })}
              >
                Cancel {affectedIssueCount} issues
              </button>
            ) : (
              <button type="button" onClick={() => createHold.mutate({ mode: "pause" })}>
                Pause and stop work
              </button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
