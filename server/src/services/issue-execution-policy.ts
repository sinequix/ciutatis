// Stub file for upstream feature not used in ciutatis
// Issue execution policy functions

export interface IssueMonitorPatch {
  monitorNextCheckAt?: Date | null;
  monitorWakeRequestedAt?: Date | null;
  monitorLastTriggeredAt?: Date | null;
  monitorAttemptCount?: number | null;
  monitorNotes?: string | null;
  monitorScheduledBy?: string | null;
  executionState?: Record<string, unknown> | null;
}

export interface IssueExecutionState {
  status: string;
  lastHeartbeatAt?: Date;
  attemptCount?: number;
  // Upstream-only: execution state tracking properties
  currentParticipant?: { type: string; agentId?: string | null } | null;
  currentStageType?: string | null;
}

export function buildInitialIssueMonitorFields(_input: {
  projectPolicy?: unknown;
  issueSettings?: unknown;
}): Record<string, unknown> {
  return {};
}

export function buildIssueMonitorClearedPatch(
  _input: {
    issue?: unknown;
    policy?: unknown;
    clearReason?: string;
    clearedAt?: Date;
  }
): IssueMonitorPatch {
  return {
    monitorNextCheckAt: null,
    monitorWakeRequestedAt: null,
    monitorLastTriggeredAt: null,
    monitorAttemptCount: null,
    monitorNotes: null,
    monitorScheduledBy: null,
  };
}

export function buildIssueMonitorTriggeredPatch(
  _opts?: { triggeredBy?: string; notes?: string; issue?: unknown; policy?: unknown; triggeredAt?: Date }
): IssueMonitorPatch {
  return {
    monitorLastTriggeredAt: new Date(),
    monitorAttemptCount: 0,
  };
}

export interface NormalizedIssueExecutionPolicy {
  monitor?: {
    serviceName?: string | null;
    timeoutAt?: string | null;
    maxAttempts?: number | null;
    recoveryPolicy?: string | null;
  } | null;
}

export function normalizeIssueExecutionPolicy(_policy: unknown): NormalizedIssueExecutionPolicy | null {
  return null;
}

export function parseIssueExecutionState(
  _state: unknown
): IssueExecutionState | null {
  return null;
}
