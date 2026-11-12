import { Link } from "@/lib/router";
import { ExternalLink, Folder, GitBranch, Server } from "lucide-react";
import type { ExecutionWorkspace } from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { WorkspaceRuntimeControlAction } from "@/api/execution-workspaces";
import type { ProjectWorkspaceSummary } from "@/lib/project-workspaces-tab";
import {
  buildWorkspaceRuntimeControlSections,
  WorkspaceRuntimeControls,
  type WorkspaceRuntimeControlCommand,
} from "./WorkspaceRuntimeControls";

export function ProjectWorkspaceSummaryCard({
  projectRef,
  summary,
  runtimeActionKey,
  runtimeActionPending,
  onRuntimeAction,
  onCloseWorkspace,
}: {
  projectRef: string;
  summary: ProjectWorkspaceSummary;
  runtimeActionKey: string | null;
  runtimeActionPending: boolean;
  onRuntimeAction: (input: {
    key: string;
    kind: ProjectWorkspaceSummary["kind"];
    workspaceId: string;
    action: WorkspaceRuntimeControlAction;
    workspaceCommandId?: string | null;
    runtimeServiceId?: string | null;
    serviceIndex?: number | null;
  }) => void;
  onCloseWorkspace: (input: { id: string; name: string; status: ExecutionWorkspace["status"] }) => void;
}) {
  const sections = buildWorkspaceRuntimeControlSections({
    runtimeConfig: summary.runtimeConfig,
    runtimeServices: summary.runtimeServices,
    canStartServices: summary.canStartServices,
    canRunJobs: summary.canRunJobs,
  });
  const localRuntimeActionKey = runtimeActionKey?.startsWith(`${summary.key}:`)
    ? runtimeActionKey.slice(summary.key.length + 1)
    : null;

  function handleRuntimeCommand(command: WorkspaceRuntimeControlCommand) {
    onRuntimeAction({
      key: summary.key,
      kind: summary.kind,
      workspaceId: summary.workspaceId,
      action: command.action,
      workspaceCommandId: command.id,
      runtimeServiceId: command.runtimeServiceId,
      serviceIndex: command.serviceIndex,
    });
  }

  return (
    <div className="rounded-md border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{summary.workspaceName}</h3>
            <Badge variant="outline" className="rounded-md px-1.5 py-0 text-[10px]">
              {summary.sourceType.replace(/_/g, " ")}
            </Badge>
            {summary.executionWorkspaceStatus ? (
              <Badge variant={summary.executionWorkspaceStatus === "cleanup_failed" ? "destructive" : "secondary"} className="rounded-md px-1.5 py-0 text-[10px]">
                {summary.executionWorkspaceStatus.replace(/_/g, " ")}
              </Badge>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {summary.cwd ? (
              <span className="inline-flex min-w-0 items-center gap-1">
                <Folder className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{summary.cwd}</span>
              </span>
            ) : null}
            {summary.repoRef ? (
              <span className="inline-flex items-center gap-1">
                <GitBranch className="h-3.5 w-3.5" />
                {summary.repoRef}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1">
              <Server className="h-3.5 w-3.5" />
              {summary.runningServiceCount} running
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {summary.detailHref ? (
            <Button asChild variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-xs">
              <Link to={summary.detailHref}>
                <ExternalLink className="h-3.5 w-3.5" />
                Open
              </Link>
            </Button>
          ) : (
            <Button asChild variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-xs">
              <Link to={`/projects/${projectRef}/configuration`}>Configure</Link>
            </Button>
          )}
          {summary.executionWorkspaceId && summary.executionWorkspaceStatus !== "archived" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() =>
                onCloseWorkspace({
                  id: summary.executionWorkspaceId!,
                  name: summary.executionWorkspaceName ?? summary.workspaceName,
                  status: summary.executionWorkspaceStatus ?? "active",
                })
              }
            >
              Close
            </Button>
          ) : null}
        </div>
      </div>
      <div className="mt-3">
        <WorkspaceRuntimeControls
          sections={sections}
          pendingKey={localRuntimeActionKey}
          pending={runtimeActionPending}
          onAction={handleRuntimeCommand}
        />
      </div>
    </div>
  );
}
