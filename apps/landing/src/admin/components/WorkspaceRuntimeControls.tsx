import { Play, RotateCcw, Square, Terminal } from "lucide-react";
import type { WorkspaceRuntimeService } from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import type { WorkspaceRuntimeControlAction } from "@/api/execution-workspaces";

export interface WorkspaceRuntimeControlCommand {
  id: string | null;
  name: string;
  kind: "service" | "job";
  action: WorkspaceRuntimeControlAction;
  serviceIndex?: number | null;
  runtimeServiceId?: string | null;
  disabled?: boolean;
}

export interface WorkspaceRuntimeControlSection {
  title: string;
  commands: WorkspaceRuntimeControlCommand[];
}

function readCommands(runtimeConfig: Record<string, unknown> | null, keys: string[], kind: "service" | "job") {
  if (!runtimeConfig) return [];
  for (const key of keys) {
    const value = runtimeConfig[key];
    if (!Array.isArray(value)) continue;
    return value
      .map((entry, index) => {
        if (!entry || typeof entry !== "object") return null;
        const record = entry as Record<string, unknown>;
        const name = typeof record.name === "string" ? record.name : `${kind}-${index + 1}`;
        return {
          id: typeof record.id === "string" ? record.id : `${kind}:${name}`,
          name,
          kind,
          serviceIndex: kind === "service" ? index : null,
        };
      })
      .filter((entry): entry is { id: string; name: string; kind: "service" | "job"; serviceIndex: number | null } => entry !== null);
  }
  return [];
}

export function buildWorkspaceRuntimeControlSections(input: {
  runtimeConfig: Record<string, unknown> | null;
  runtimeServices: WorkspaceRuntimeService[];
  canStartServices: boolean;
  canRunJobs: boolean;
}): WorkspaceRuntimeControlSection[] {
  const services = readCommands(input.runtimeConfig, ["services", "serviceCommands"], "service");
  const jobs = readCommands(input.runtimeConfig, ["jobs", "commands", "tasks"], "job");
  const runningService = input.runtimeServices.find((service) => service.status === "running" || service.status === "starting");
  const sections: WorkspaceRuntimeControlSection[] = [];

  if (services.length > 0) {
    sections.push({
      title: "Services",
      commands: services.flatMap((service) => [
        {
          id: service.id,
          name: `Start ${service.name}`,
          kind: "service" as const,
          action: "start" as const,
          serviceIndex: service.serviceIndex,
          disabled: !input.canStartServices,
        },
        {
          id: service.id,
          name: `Restart ${service.name}`,
          kind: "service" as const,
          action: "restart" as const,
          serviceIndex: service.serviceIndex,
          runtimeServiceId: runningService?.id ?? null,
          disabled: !input.canStartServices,
        },
        {
          id: service.id,
          name: `Stop ${service.name}`,
          kind: "service" as const,
          action: "stop" as const,
          runtimeServiceId: runningService?.id ?? null,
          disabled: !runningService,
        },
      ]),
    });
  }

  if (jobs.length > 0) {
    sections.push({
      title: "Jobs",
      commands: jobs.map((job) => ({
        id: job.id,
        name: job.name,
        kind: "job",
        action: "run",
        disabled: !input.canRunJobs,
      })),
    });
  }

  return sections;
}

function Icon({ action }: { action: WorkspaceRuntimeControlAction }) {
  if (action === "stop") return <Square className="h-3.5 w-3.5" />;
  if (action === "restart") return <RotateCcw className="h-3.5 w-3.5" />;
  if (action === "run") return <Terminal className="h-3.5 w-3.5" />;
  return <Play className="h-3.5 w-3.5" />;
}

export function WorkspaceRuntimeControls({
  sections,
  pendingKey,
  pending,
  onAction,
}: {
  sections: WorkspaceRuntimeControlSection[];
  pendingKey: string | null;
  pending: boolean;
  onAction: (command: WorkspaceRuntimeControlCommand) => void;
}) {
  if (sections.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {sections.map((section) => (
        <div key={section.title} className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {section.title}
          </span>
          {section.commands.map((command) => {
            const key = `${command.id ?? command.name}:${command.action}`;
            return (
              <Button
                key={key}
                type="button"
                variant="outline"
                size="sm"
                disabled={command.disabled || (pending && pendingKey !== key)}
                onClick={() => onAction(command)}
                className="h-7 gap-1.5 px-2 text-xs"
              >
                <Icon action={command.action} />
                <span>{pending && pendingKey === key ? "Working" : command.name}</span>
              </Button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
