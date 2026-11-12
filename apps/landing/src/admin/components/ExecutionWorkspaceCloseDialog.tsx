import { useMutation, useQuery } from "@tanstack/react-query";
import type { ExecutionWorkspace } from "@paperclipai/shared";
import { executionWorkspacesApi } from "@/api/execution-workspaces";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function readStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

export function ExecutionWorkspaceCloseDialog({
  workspaceId,
  workspaceName,
  currentStatus,
  open,
  onOpenChange,
  onClosed,
}: {
  workspaceId: string;
  workspaceName: string;
  currentStatus: ExecutionWorkspace["status"];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClosed: () => void;
}) {
  const readiness = useQuery({
    queryKey: ["execution-workspaces", "close-readiness", workspaceId],
    queryFn: () => executionWorkspacesApi.closeReadiness(workspaceId),
    enabled: open,
  });
  const closeWorkspace = useMutation({
    mutationFn: () => executionWorkspacesApi.update(workspaceId, { status: "archived" }),
    onSuccess: onClosed,
  });
  const readinessRecord = readiness.data ?? {};
  const blockingReasons = readStringList(readinessRecord.blockingReasons);
  const warnings = readStringList(readinessRecord.warnings);
  const blocked = blockingReasons.length > 0 || readinessRecord.state === "blocked";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Close workspace</DialogTitle>
          <DialogDescription>
            Close {workspaceName}. Runtime services will be stopped and cleanup will run when configured.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Current status</div>
            <div className="mt-1">{currentStatus.replace(/_/g, " ")}</div>
          </div>
          {blocked ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-destructive">
              {blockingReasons[0] ?? "This workspace cannot be closed right now."}
            </div>
          ) : null}
          {warnings.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              {warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={blocked || closeWorkspace.isPending || readiness.isLoading}
            onClick={() => closeWorkspace.mutate()}
          >
            {closeWorkspace.isPending ? "Closing..." : "Close workspace"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
