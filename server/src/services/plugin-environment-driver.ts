// Stub - plugin-environment-driver not in Ciutatis V1 scope
// This file exists only to satisfy upstream imports

export interface PluginEnvironmentDriverService {
  provision(): Promise<void>;
  teardown(): Promise<void>;
}

export function pluginEnvironmentDriverService(): PluginEnvironmentDriverService {
  return {
    async provision() {
      // No-op
    },
    async teardown() {
      // No-op
    },
  };
}

// Stub exports for upstream compatibility
export interface PluginSandboxProviderDriver {
  plugin: {
    id: string;
    pluginKey: string;
    status: "ready" | "pending" | "error";
    name?: string;
    version?: string;
  };
  driver?: {
    id: string;
    pluginKey: string;
    config?: Record<string, unknown>;
    configSchema?: Record<string, unknown>;
  };
}

export function listReadyPluginEnvironmentDrivers(): unknown[] {
  return [];
}

export function resolvePluginSandboxProviderDriverByKey(_input?: {
  db?: unknown;
  driverKey?: string;
  workerManager?: unknown;
  requireRunning?: boolean;
}): PluginSandboxProviderDriver | undefined {
  return undefined;
}

export function validatePluginEnvironmentDriverConfig(_input?: {
  db?: unknown;
  workerManager?: unknown;
  driverKey?: string;
  config?: Record<string, unknown>;
}): Promise<{ valid: boolean; errors: string[]; normalizedConfig?: Record<string, unknown>; driver?: { driverKey: string; configSchema?: Record<string, unknown> } }> {
  return Promise.resolve({ valid: true, errors: [], normalizedConfig: {}, driver: { driverKey: "stub" } });
}

export function validatePluginSandboxProviderConfig(_input?: {
  db?: unknown;
  workerManager?: unknown;
  provider?: string;
  config?: Record<string, unknown>;
}): Promise<{ valid: boolean; errors: string[]; normalizedConfig?: Record<string, unknown>; driver?: { driverKey: string; configSchema?: Record<string, unknown> } }> {
  return Promise.resolve({ valid: true, errors: [], normalizedConfig: {}, driver: { driverKey: "stub" } });
}

export function probePluginEnvironmentDriver(_input: {
  db?: unknown;
  workerManager?: unknown;
  companyId?: string;
  environmentId?: string;
  config?: Record<string, unknown>;
}): Promise<{ ok: boolean; success: boolean; driver: string; summary: string; details?: Record<string, unknown> }> {
  return Promise.resolve({
    ok: false,
    success: false,
    driver: "plugin",
    summary: "Plugin environment driver not available in Ciutatis",
    details: {},
  });
}

export function probePluginSandboxProviderDriver(_input: {
  db?: unknown;
  workerManager?: unknown;
  companyId?: string;
  environmentId?: string;
  provider?: string;
  config?: Record<string, unknown>;
}): Promise<{ ok: boolean; success: boolean; driver: string; summary: string; details?: Record<string, unknown> }> {
  return Promise.resolve({
    ok: false,
    success: false,
    driver: "sandbox",
    summary: "Plugin sandbox provider not available in Ciutatis",
    details: {},
  });
}

export function destroyPluginEnvironmentLease(_input?: {
  db?: unknown;
  workerManager?: unknown;
  companyId?: string | null;
  environmentId?: string;
  config?: Record<string, unknown>;
  providerLeaseId?: string | null;
  leaseMetadata?: Record<string, unknown>;
}): Promise<void> {
  return Promise.resolve();
}

export function executePluginEnvironmentCommand(_input?: {
  db?: unknown;
  workerManager?: unknown;
  pluginId?: string;
  config?: Record<string, unknown>;
  params?: Record<string, unknown>;
}): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
  return Promise.resolve({ exitCode: 0, stdout: "", stderr: "", timedOut: false });
}

export function realizePluginEnvironmentWorkspace(_input?: {
  db?: unknown;
  workerManager?: unknown;
  pluginId?: string;
  config?: Record<string, unknown>;
  params?: Record<string, unknown>;
}): Promise<{ cwd: string; metadata: Record<string, unknown> }> {
  return Promise.resolve({ cwd: "/tmp", metadata: {} });
}

export function resolvePluginExecuteRpcTimeoutMs(input: {
  requestedTimeoutMs?: number | undefined;
  config?: Record<string, unknown> | null;
}): number {
  return input.requestedTimeoutMs ?? 60000;
}

export function resumePluginEnvironmentLease(_input?: {
  db?: unknown;
  workerManager?: unknown;
  companyId?: string | null;
  environmentId?: string;
  config?: Record<string, unknown>;
  providerLeaseId?: string;
  leaseMetadata?: Record<string, unknown>;
}): Promise<{ providerLeaseId: string; expiresAt?: string | null; metadata?: Record<string, unknown> }> {
  return Promise.resolve({ providerLeaseId: "stub" });
}
