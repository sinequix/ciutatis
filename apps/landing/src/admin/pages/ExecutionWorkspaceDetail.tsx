import { Link, useParams } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { executionWorkspacesApi } from "../api/execution-workspaces";
import { queryKeys } from "../lib/queryKeys";

function isSafeExternalUrl(value: string | null | undefined) {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <div className="w-28 shrink-0 text-xs text-muted-foreground">{label}</div>
      <div className="min-w-0 flex-1 text-sm">{children}</div>
    </div>
  );
}

export function ExecutionWorkspaceDetail() {
  const { workspaceId } = useParams<{ workspaceId: string }>();

  const { data: workspace, isLoading, error } = useQuery({
    queryKey: queryKeys.executionWorkspaces.detail(workspaceId!),
    queryFn: () => executionWorkspacesApi.get(workspaceId!),
    enabled: Boolean(workspaceId),
  });

  if (isLoading) {
    return (
      <div className="max-w-2xl space-y-4">
        <div className="space-y-1">
          <div className="h-3 w-32 bg-accent/75 rounded-md animate-pulse" />
          <div className="h-8 w-64 bg-accent/75 rounded-md animate-pulse" />
          <div className="h-4 w-48 bg-accent/75 rounded-md animate-pulse" />
        </div>
        <div className="rounded-lg border border-border p-4 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="h-4 w-28 bg-accent/75 rounded-md animate-pulse shrink-0" />
              <div className="h-4 w-full bg-accent/75 rounded-md animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="bg-muted/50 p-4 mb-4 rounded-md">
          <span className="text-2xl">⚠️</span>
        </div>
        <p className="text-sm text-destructive mb-2">
          {error instanceof Error ? error.message : "Failed to load workspace"}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="text-sm text-primary hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }
  if (!workspace) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="bg-muted/50 p-4 mb-4 rounded-md">
          <span className="text-2xl">🔍</span>
        </div>
        <p className="text-sm text-muted-foreground">Workspace not found.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">Execution workspace</div>
        <h1 className="text-2xl font-semibold">{workspace.name}</h1>
        <div className="text-sm text-muted-foreground">
          {workspace.status} · {workspace.mode} · {workspace.providerType}
        </div>
      </div>

      <div className="rounded-lg border border-border p-4">
        <DetailRow label="Project">
          {workspace.projectId ? <Link to={`/projects/${workspace.projectId}`} className="hover:underline">{workspace.projectId}</Link> : "None"}
        </DetailRow>
        <DetailRow label="Source issue">
          {workspace.sourceIssueId ? <Link to={`/issues/${workspace.sourceIssueId}`} className="hover:underline">{workspace.sourceIssueId}</Link> : "None"}
        </DetailRow>
        <DetailRow label="Branch">{workspace.branchName ?? "None"}</DetailRow>
        <DetailRow label="Base ref">{workspace.baseRef ?? "None"}</DetailRow>
        <DetailRow label="Working dir">
          <span className="break-all font-mono text-xs">{workspace.cwd ?? "None"}</span>
        </DetailRow>
        <DetailRow label="Provider ref">
          <span className="break-all font-mono text-xs">{workspace.providerRef ?? "None"}</span>
        </DetailRow>
        <DetailRow label="Repo URL">
          {workspace.repoUrl && isSafeExternalUrl(workspace.repoUrl) ? (
            <a href={workspace.repoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
              {workspace.repoUrl}
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : workspace.repoUrl ? (
            <span className="break-all font-mono text-xs">{workspace.repoUrl}</span>
          ) : "None"}
        </DetailRow>
        <DetailRow label="Opened">{new Date(workspace.openedAt).toLocaleString()}</DetailRow>
        <DetailRow label="Last used">{new Date(workspace.lastUsedAt).toLocaleString()}</DetailRow>
        <DetailRow label="Cleanup">
          {workspace.cleanupEligibleAt ? `${new Date(workspace.cleanupEligibleAt).toLocaleString()}${workspace.cleanupReason ? ` · ${workspace.cleanupReason}` : ""}` : "Not scheduled"}
        </DetailRow>
      </div>
    </div>
  );
}
