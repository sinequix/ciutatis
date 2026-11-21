import { Link, useParams } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { executionWorkspacesApi } from "../api/execution-workspaces";
import { queryKeys } from "../lib/queryKeys";

type ConfiguredRuntimeServicePort = {
  collection: "commands" | "services";
  index: number;
  name: string;
  port: number | null;
  invalidPort: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPort(portConfig: unknown): { port: number | null; invalidPort: boolean } {
  if (typeof portConfig === "number") {
    return {
      port: portConfig,
      invalidPort: !Number.isInteger(portConfig) || portConfig < 1 || portConfig > 65535,
    };
  }
  if (isRecord(portConfig) && Object.hasOwn(portConfig, "value")) {
    const value = portConfig.value;
    if (typeof value !== "number") return { port: null, invalidPort: true };
    return {
      port: value,
      invalidPort: !Number.isInteger(value) || value < 1 || value > 65535,
    };
  }
  return { port: null, invalidPort: false };
}

export function readConfiguredRuntimeServicePorts(runtimeConfig: Record<string, unknown> | null) {
  if (!runtimeConfig) return [];
  const entries: ConfiguredRuntimeServicePort[] = [];
  const addServices = (
    collection: ConfiguredRuntimeServicePort["collection"],
    services: unknown,
    commandsRequireServiceKind: boolean,
  ) => {
    if (!Array.isArray(services)) return;
    services.forEach((service, index) => {
      if (!isRecord(service)) return;
      if (commandsRequireServiceKind && service.kind !== "service") return;
      const parsed = readPort(service.port);
      const name = service.name;
      entries.push({
        collection,
        index,
        name: typeof name === "string" && name.trim() ? name : `Service ${index + 1}`,
        port: parsed.port,
        invalidPort: parsed.invalidPort,
      });
    });
  };
  addServices("commands", runtimeConfig.commands, true);
  addServices("services", runtimeConfig.services, false);
  return entries;
}

export function updateConfiguredRuntimeServicePort(input: {
  runtimeConfig: Record<string, unknown>;
  service: ConfiguredRuntimeServicePort;
  port: string;
}) {
  const runtimeConfig = structuredClone(input.runtimeConfig);
  const entries = runtimeConfig[input.service.collection];
  if (!Array.isArray(entries)) return runtimeConfig;
  const entry = entries[input.service.index];
  if (!isRecord(entry)) return runtimeConfig;
  const existingPort = isRecord(entry.port) ? entry.port : null;
  const trimmedPort = input.port.trim();
  if (!trimmedPort) {
    if (existingPort) {
      const autoPort: Record<string, unknown> = { ...existingPort, type: "auto" };
      delete autoPort.value;
      entry.port = autoPort;
    } else {
      delete entry.port;
    }
    return runtimeConfig;
  }
  const port = Number(trimmedPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return runtimeConfig;
  entry.port = { ...existingPort, type: "fixed", value: port };
  return runtimeConfig;
}

export function getConfiguredRuntimeServicePortWarnings(services: ConfiguredRuntimeServicePort[]) {
  const servicesByPort = new Map<number, ConfiguredRuntimeServicePort[]>();
  for (const service of services) {
    if (service.invalidPort || service.port === null) continue;
    const servicesForPort = servicesByPort.get(service.port) ?? [];
    servicesForPort.push(service);
    servicesByPort.set(service.port, servicesForPort);
  }
  return Array.from(servicesByPort.entries())
    .filter(([, servicesForPort]) => servicesForPort.length > 1)
    .map(([port, servicesForPort]) =>
      `Port ${port} is assigned to multiple services: ${servicesForPort.map((service) => service.name).join(", ")}.`,
    );
}

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
