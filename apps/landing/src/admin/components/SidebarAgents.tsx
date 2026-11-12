import { useMemo, useState } from "react";
import { NavLink, useLocation } from "@/lib/router";
import { Link } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, MoreHorizontal, Pause, Pencil, Play, Plus } from "lucide-react";
import { useCompany } from "../context/CompanyContext";
import { useDialogActions } from "../context/DialogContext";
import { useSidebar } from "../context/SidebarContext";
import { useToastActions } from "../context/ToastContext";
import { agentsApi } from "../api/agents";
import { heartbeatsApi } from "../api/heartbeats";
import { queryKeys } from "../lib/queryKeys";
import { cn, agentRouteRef, agentUrl } from "../lib/utils";
import { AgentIcon } from "./AgentIconPicker";
import { BudgetSidebarMarker } from "./BudgetSidebarMarker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { Agent } from "@paperclipai/shared";

/** BFS sort: roots first (no reportsTo), then their direct reports, etc. */
function sortByHierarchy(agents: Agent[]): Agent[] {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const childrenOf = new Map<string | null, Agent[]>();
  for (const a of agents) {
    const parent = a.reportsTo && byId.has(a.reportsTo) ? a.reportsTo : null;
    const list = childrenOf.get(parent) ?? [];
    list.push(a);
    childrenOf.set(parent, list);
  }
  const sorted: Agent[] = [];
  const queue = childrenOf.get(null) ?? [];
  while (queue.length > 0) {
    const agent = queue.shift()!;
    sorted.push(agent);
    const children = childrenOf.get(agent.id);
    if (children) queue.push(...children);
  }
  return sorted;
}

export function SidebarAgents() {
  const [open, setOpen] = useState(true);
  const [updatingAgentId, setUpdatingAgentId] = useState<string | null>(null);
  const { selectedCompanyId } = useCompany();
  const { openNewAgent } = useDialogActions();
  const { isMobile, setSidebarOpen } = useSidebar();
  const { pushToast } = useToastActions();
  const queryClient = useQueryClient();
  const location = useLocation();

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: liveRuns } = useQuery({
    queryKey: queryKeys.liveRuns(selectedCompanyId!),
    queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 10_000,
  });

  const liveCountByAgent = useMemo(() => {
    const counts = new Map<string, number>();
    for (const run of liveRuns ?? []) {
      counts.set(run.agentId, (counts.get(run.agentId) ?? 0) + 1);
    }
    return counts;
  }, [liveRuns]);

  const visibleAgents = useMemo(() => {
    const filtered = (agents ?? []).filter(
      (a: Agent) => a.status !== "terminated"
    );
    return sortByHierarchy(filtered);
  }, [agents]);

  const agentMatch = location.pathname.match(/^\/(?:[^/]+\/)?agents\/([^/]+)/);
  const activeAgentId = agentMatch?.[1] ?? null;
  const invalidateAgents = () => {
    if (!selectedCompanyId) return;
    queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(selectedCompanyId) });
  };
  const pauseMutation = useMutation({
    mutationFn: (agent: Agent) => agentsApi.pause(agent.id, selectedCompanyId ?? undefined),
    onMutate: (agent) => {
      setUpdatingAgentId(agent.id);
    },
    onSuccess: () => {
      invalidateAgents();
      pushToast({ title: "Agent paused", tone: "success" });
    },
    onError: (error) => {
      pushToast({
        title: "Unable to pause agent",
        body: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    },
    onSettled: () => {
      setUpdatingAgentId(null);
    },
  });
  const resumeMutation = useMutation({
    mutationFn: (agent: Agent) => agentsApi.resume(agent.id, selectedCompanyId ?? undefined),
    onMutate: (agent) => {
      setUpdatingAgentId(agent.id);
    },
    onSuccess: () => {
      invalidateAgents();
      pushToast({ title: "Agent resumed", tone: "success" });
    },
    onError: (error) => {
      pushToast({
        title: "Unable to resume agent",
        body: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    },
    onSettled: () => {
      setUpdatingAgentId(null);
    },
  });

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="group">
        <div className="flex items-center px-3 py-1.5">
          <CollapsibleTrigger className="flex items-center gap-1 flex-1 min-w-0">
            <ChevronRight
              className={cn(
                "h-3 w-3 text-muted-foreground/60 transition-transform opacity-0 group-hover:opacity-100",
                open && "rotate-90"
              )}
            />
            <span className="text-[10px] font-medium uppercase tracking-widest font-mono text-muted-foreground/60">
              Agents
            </span>
          </CollapsibleTrigger>
          <button
            onClick={(e) => {
              e.stopPropagation();
              openNewAgent();
            }}
            className="flex items-center justify-center h-4 w-4 rounded text-muted-foreground/60 hover:text-foreground hover:bg-accent/50 transition-colors"
            aria-label="New agent"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
      </div>

      <CollapsibleContent>
        <div className="flex flex-col gap-0.5 mt-0.5">
          {visibleAgents.map((agent: Agent) => {
            const runCount = liveCountByAgent.get(agent.id) ?? 0;
            return (
              <NavLink
                key={agent.id}
                to={agentUrl(agent)}
                onClick={() => {
                  if (isMobile) setSidebarOpen(false);
                }}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-1.5 text-[13px] font-medium transition-colors",
                  activeAgentId === agentRouteRef(agent)
                    ? "bg-accent text-foreground"
                    : "text-foreground/80 hover:bg-accent/50 hover:text-foreground"
                )}
              >
                <AgentIcon icon={agent.icon} className="shrink-0 h-3.5 w-3.5 text-muted-foreground" />
                <span className="flex-1 truncate">{agent.name}</span>
                {(agent.pauseReason === "budget" || runCount > 0) && (
                  <span className="ml-auto flex items-center gap-1.5 shrink-0">
                    {agent.pauseReason === "budget" ? (
                      <BudgetSidebarMarker title="Agent paused by budget" />
                    ) : null}
                    {runCount > 0 ? (
                      <span className="relative flex h-2 w-2">
                        <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                      </span>
                    ) : null}
                    {runCount > 0 ? (
                      <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400">
                        {runCount} live
                      </span>
                    ) : null}
                  </span>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="ml-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition hover:bg-accent hover:text-foreground group-hover:opacity-100 focus:opacity-100"
                      aria-label={`Open actions for ${agent.name}`}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem asChild>
                      <Link to={`${agentUrl(agent)}/configuration`}>
                        <Pencil className="h-3.5 w-3.5" />
                        Edit agent
                      </Link>
                    </DropdownMenuItem>
                    {agent.pauseReason === "budget" ? (
                      <DropdownMenuItem disabled>
                        <Pause className="h-3.5 w-3.5" />
                        Budget paused
                      </DropdownMenuItem>
                    ) : agent.status === "paused" ? (
                      <DropdownMenuItem
                        disabled={updatingAgentId === agent.id}
                        onSelect={(event) => {
                          event.preventDefault();
                          resumeMutation.mutate(agent);
                        }}
                      >
                        <Play className="h-3.5 w-3.5" />
                        {updatingAgentId === agent.id ? "Updating..." : "Resume agent"}
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        disabled={updatingAgentId === agent.id}
                        onSelect={(event) => {
                          event.preventDefault();
                          pauseMutation.mutate(agent);
                        }}
                      >
                        <Pause className="h-3.5 w-3.5" />
                        {updatingAgentId === agent.id ? "Updating..." : "Pause agent"}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </NavLink>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
