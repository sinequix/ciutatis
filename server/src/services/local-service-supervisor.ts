export interface ProcessGroupStatus {
  alive: boolean;
  pid?: number;
  lastHeartbeatAt?: Date;
}

export interface LocalServiceRegistryRecord {
  serviceKey: string;
  runtimeServiceId: string;
  port: number;
  pid: number;
  createdAt: string;
  lastTouchedAt: string;
  processGroupId?: string | null;
  reuseKey?: string;
  url?: string;
  startedAt?: string;
  command?: string | null;
  cwd?: string;
  envFingerprint?: string;
  profileKind?: string;
  serviceName?: string;
  lastSeenAt?: string;
}

export function isProcessGroupAlive(
  _processGroupId: string,
  _opts?: { timeoutMs?: number }
): Promise<boolean> {
  return Promise.resolve(false);
}

export function getProcessGroupStatus(
  _processGroupId: string
): Promise<ProcessGroupStatus | null> {
  return Promise.resolve(null);
}

export function terminateLocalService(
  input: { pid: number; processGroupId?: number | string | null },
  opts?: { timeoutMs?: number; signal?: NodeJS.Signals },
): Promise<boolean> {
  const timeoutMs = Math.max(100, opts?.timeoutMs ?? 2_000);
  const signal = opts?.signal ?? "SIGTERM";
  const processGroupId = Number(input.processGroupId ?? 0);
  const target =
    process.platform !== "win32" && Number.isInteger(processGroupId) && processGroupId > 0
      ? -processGroupId
      : input.pid;

  function isAlive() {
    try {
      process.kill(input.pid, 0);
      return true;
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && err.code === "ESRCH") {
        return false;
      }
      return true;
    }
  }

  async function waitForExit(deadline: number) {
    while (Date.now() < deadline) {
      if (!isAlive()) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return !isAlive();
  }

  return (async () => {
    try {
      process.kill(target, signal);
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && err.code === "ESRCH") {
        return false;
      }
    }

    if (await waitForExit(Date.now() + timeoutMs)) return true;

    try {
      process.kill(target, "SIGKILL");
    } catch {
      return !isAlive();
    }
    return waitForExit(Date.now() + 1_000);
  })();
}

export interface CreateLocalServiceKeyInput {
  profileKind: string;
  serviceName: string;
  cwd: string;
  command: string;
  envFingerprint: string;
  port: number | null;
  scope: {
    scopeType: string;
    scopeId: string;
    executionWorkspaceId: string | null;
    reuseKey?: string | null;
  };
}

export function createLocalServiceKey(_input?: CreateLocalServiceKeyInput): string {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export async function findLocalServiceRegistryRecordByRuntimeServiceId(
  _input: string | { runtimeServiceId: string; profileKind?: string }
): Promise<LocalServiceRegistryRecord | null> {
  return null;
}

export interface FindAdoptableLocalServiceInput {
  serviceKey: string;
  command: string | null;
  cwd: string;
  envFingerprint: string;
  port: number | null;
  reuseKey?: string | null;
}

export async function findAdoptableLocalService(
  _input: string | FindAdoptableLocalServiceInput,
  _opts?: { reuseKey?: string }
): Promise<LocalServiceRegistryRecord | null> {
  return null;
}

export async function readLocalServicePortOwner(
  _port: number
): Promise<LocalServiceRegistryRecord | null> {
  return null;
}

export async function removeLocalServiceRegistryRecord(
  _serviceKey: string
): Promise<void> {
  return;
}

async function readProcessGroupId(pid: number) {
  if (process.platform === "win32") return null;
  try {
    const { stdout } = await execFileAsync("ps", ["-o", "pgid=", "-p", String(pid)]);
    const parsed = Number.parseInt(stdout.trim(), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

async function adoptLocalServiceFromPortOwner(input: {
  serviceKey: string;
  profileKind?: string | null;
  serviceName?: string | null;
  command?: string | null;
  cwd?: string | null;
  envFingerprint?: string | null;
  port?: number | null;
  url?: string | null;
}) {
  if (!input.port) return null;
  const ownerPid = await readLocalServicePortOwner(input.port);
  if (!ownerPid) return null;

  if (input.cwd) {
    const ownerCwd = await readLocalServiceProcessCwd(ownerPid);
    if (!ownerCwd || !(await isLocalServiceProcessInWorkspace(ownerCwd, input.cwd))) {
      return null;
    }
  }

  const processGroupId = await readProcessGroupId(ownerPid);
  const pid = processGroupId && isPidAlive(processGroupId) ? processGroupId : ownerPid;
  const now = new Date().toISOString();
  const record: LocalServiceRegistryRecord = {
    version: 1,
    serviceKey: input.serviceKey,
    profileKind: input.profileKind ?? "workspace-runtime",
    serviceName: input.serviceName ?? "service",
    command: input.command ?? input.serviceName ?? "service",
    cwd: input.cwd ?? process.cwd(),
    envFingerprint: input.envFingerprint ?? "",
    port: input.port,
    url: input.url ?? null,
    pid,
    processGroupId: processGroupId ?? pid,
    provider: "local_process",
    runtimeServiceId: null,
    reuseKey: input.envFingerprint ?? null,
    startedAt: now,
    lastSeenAt: now,
    metadata: null,
  };

  if (!(await isLikelyMatchingCommand(record))) return null;
  await writeLocalServiceRegistryRecord(record);
  return record;
}

export async function touchLocalServiceRegistryRecord(
  _serviceKey: string,
  _opts?: { runtimeServiceId?: string; lastSeenAt?: string }
): Promise<void> {
  return;
}

export async function writeLocalServiceRegistryRecord(
  _serviceKey: string,
  _record: Partial<LocalServiceRegistryRecord>
): Promise<void> {
  return;
}

export async function readLocalServiceProcessCwd(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0 || process.platform !== "linux") return null;
  try {
    return await fs.readlink(`/proc/${pid}/cwd`);
  } catch {
    return null;
  }
}

export async function isLocalServiceProcessInWorkspace(processCwd: string, workspaceCwd: string) {
  try {
    const [resolvedProcessCwd, resolvedWorkspaceCwd] = await Promise.all([
      fs.realpath(processCwd),
      fs.realpath(workspaceCwd),
    ]);
    const relativePath = path.relative(resolvedWorkspaceCwd, resolvedProcessCwd);
    return relativePath === "" || (!relativePath.startsWith(`..${path.sep}`) && relativePath !== "..");
  } catch {
    return false;
  }
}

export async function isLocalServiceRegistryCwdCompatible(processCwd: string | null, workspaceCwd: string) {
  if (!processCwd) return process.platform !== "linux";
  return isLocalServiceProcessInWorkspace(processCwd, workspaceCwd);
}

async function doesLocalServiceRecordMatchCwd(record: LocalServiceRegistryRecord) {
  if (!record.port) return true;
  const ownerPid = await readLocalServicePortOwner(record.port);
  if (!ownerPid) return false;
  const ownerCwd = await readLocalServiceProcessCwd(ownerPid);
  return isLocalServiceRegistryCwdCompatible(ownerCwd, record.cwd);
}
