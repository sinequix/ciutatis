import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  createDb,
  agents,
  agentRuntimeState,
  agentWakeupRequests,
  heartbeatRunEvents,
  heartbeatRuns,
  issueComments,
  issues,
  objectives,
  projects,
  type Db,
} from "@ciutatis/db-cloudflare";
import type { ExecutionContext } from "hono";
import { execute as executeCloudflareWorkersAi } from "@ciutatis/adapter-cloudflare-workers-ai/workers";
import type { Env } from "./types.js";

interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

interface AdapterExecutionResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  errorMessage?: string | null;
  errorCode?: string | null;
  usage?: UsageSummary;
  resultJson?: Record<string, unknown> | null;
}

interface AdapterInvocationMeta {
  adapterType: string;
  command: string;
  cwd?: string;
  commandArgs?: string[];
  commandNotes?: string[];
  env?: Record<string, string>;
  prompt?: string;
  promptMetrics?: Record<string, number>;
  context?: Record<string, unknown>;
}

type WakeupSource = "timer" | "assignment" | "on_demand" | "automation";
type WakeupTriggerDetail = "manual" | "ping" | "callback" | "system" | null;
type WakeupActorType = "user" | "agent" | "system" | null;

interface QueueHostedHeartbeatInput {
  db: Db;
  env: Env;
  executionCtx: ExecutionContext;
  agentId: string;
  source?: WakeupSource | string | null;
  triggerDetail?: WakeupTriggerDetail | string;
  reason?: string | null;
  payload?: Record<string, unknown> | null;
  idempotencyKey?: string | null;
  requestedByActorType?: WakeupActorType;
  requestedByActorId?: string | null;
  contextSnapshot?: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeAgentNameKey(value: unknown): string | null {
  const raw = nonEmpty(value);
  return raw ? raw.toLowerCase().replace(/\s+/g, "-") : null;
}

function sanitizeAdapterEnv(input: unknown): Record<string, string> {
  const record = asRecord(input) ?? {};
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string" && value.trim().length > 0) {
      env[key] = value.trim();
    }
  }
  return env;
}

function workerAdapterEnv(env: Env): Record<string, string> {
  const result: Record<string, string> = {};
  if (typeof env.CLOUDFLARE_ACCOUNT_ID === "string" && env.CLOUDFLARE_ACCOUNT_ID.trim()) {
    result.CLOUDFLARE_ACCOUNT_ID = env.CLOUDFLARE_ACCOUNT_ID.trim();
  }
  if (typeof env.CLOUDFLARE_API_TOKEN === "string" && env.CLOUDFLARE_API_TOKEN.trim()) {
    result.CLOUDFLARE_API_TOKEN = env.CLOUDFLARE_API_TOKEN.trim();
  }
  return result;
}

function normalizeWakeupSource(value: unknown): WakeupSource {
  switch (value) {
    case "timer":
    case "assignment":
    case "automation":
      return value;
    default:
      return "on_demand";
  }
}

function normalizeTriggerDetail(value: unknown): WakeupTriggerDetail {
  switch (value) {
    case "manual":
    case "ping":
    case "callback":
    case "system":
      return value;
    default:
      return null;
  }
}

function deriveIssueId(
  contextSnapshot: Record<string, unknown> | null | undefined,
  payload: Record<string, unknown> | null | undefined,
) {
  return nonEmpty(contextSnapshot?.issueId) ?? nonEmpty(contextSnapshot?.taskId) ?? nonEmpty(payload?.issueId);
}

function deriveCommentId(
  contextSnapshot: Record<string, unknown> | null | undefined,
  payload: Record<string, unknown> | null | undefined,
) {
  return (
    nonEmpty(contextSnapshot?.wakeCommentId) ??
    nonEmpty(contextSnapshot?.commentId) ??
    nonEmpty(payload?.commentId)
  );
}

function enrichContextSnapshot(input: {
  source: WakeupSource;
  triggerDetail: WakeupTriggerDetail;
  reason: string | null;
  payload: Record<string, unknown> | null;
  contextSnapshot: Record<string, unknown>;
}) {
  const { source, triggerDetail, reason, payload, contextSnapshot } = input;
  const issueId = deriveIssueId(contextSnapshot, payload);
  const commentId = deriveCommentId(contextSnapshot, payload);

  if (issueId && !nonEmpty(contextSnapshot.issueId)) contextSnapshot.issueId = issueId;
  if (issueId && !nonEmpty(contextSnapshot.taskId)) contextSnapshot.taskId = issueId;
  if (commentId && !nonEmpty(contextSnapshot.commentId)) contextSnapshot.commentId = commentId;
  if (commentId && !nonEmpty(contextSnapshot.wakeCommentId)) contextSnapshot.wakeCommentId = commentId;
  if (reason && !nonEmpty(contextSnapshot.wakeReason)) contextSnapshot.wakeReason = reason;
  if (!nonEmpty(contextSnapshot.wakeSource)) contextSnapshot.wakeSource = source;
  if (triggerDetail && !nonEmpty(contextSnapshot.wakeTriggerDetail)) {
    contextSnapshot.wakeTriggerDetail = triggerDetail;
  }

  return contextSnapshot;
}

function usageTotals(usage: UsageSummary | undefined) {
  return {
    inputTokens: Math.max(0, usage?.inputTokens ?? 0),
    outputTokens: Math.max(0, usage?.outputTokens ?? 0),
    cachedInputTokens: Math.max(0, usage?.cachedInputTokens ?? 0),
  };
}

function deriveFinalStatus(result: AdapterExecutionResult, existingStatus: string | null) {
  if (existingStatus === "cancelled") return "cancelled" as const;
  if (result.timedOut) return "timed_out" as const;
  if ((result.exitCode ?? 1) === 0 && !result.errorCode && !result.errorMessage) {
    return "succeeded" as const;
  }
  return "failed" as const;
}

function chunkToEvent(stream: "stdout" | "stderr", chunk: string) {
  const payload: Record<string, unknown> = { rawChunk: chunk };
  const parsed = asRecord(
    (() => {
      try {
        return JSON.parse(chunk);
      } catch {
        return null;
      }
    })(),
  );
  if (parsed) payload.parsed = parsed;

  return {
    eventType: "log",
    stream,
    level: stream === "stderr" ? "error" as const : null,
    message: chunk,
    payload,
  };
}

async function insertRunEvent(
  db: Db,
  input: {
    companyId: string;
    runId: string;
    agentId: string;
    nextSeq: number;
    eventType: string;
    stream?: "stdout" | "stderr" | "system" | null;
    level?: "info" | "warn" | "error" | null;
    color?: string | null;
    message?: string | null;
    payload?: Record<string, unknown> | null;
  },
) {
  await db.insert(heartbeatRunEvents).values({
    companyId: input.companyId,
    runId: input.runId,
    agentId: input.agentId,
    seq: input.nextSeq,
    eventType: input.eventType,
    stream: input.stream ?? null,
    level: input.level ?? null,
    color: input.color ?? null,
    message: input.message ?? null,
    payload: input.payload ?? null,
    createdAt: new Date().toISOString(),
  });
}

async function getRun(db: Db, runId: string) {
  return db
    .select()
    .from(heartbeatRuns)
    .where(eq(heartbeatRuns.id, runId))
    .then((rows) => rows[0] ?? null);
}

async function getAgent(db: Db, agentId: string) {
  return db
    .select()
    .from(agents)
    .where(eq(agents.id, agentId))
    .then((rows) => rows[0] ?? null);
}

async function getActiveIssueRunId(db: Db, companyId: string, issueId: string) {
  return db
    .select({ id: heartbeatRuns.id })
    .from(heartbeatRuns)
    .where(
      and(
        eq(heartbeatRuns.companyId, companyId),
        inArray(heartbeatRuns.status, ["queued", "running"]),
        sql`${heartbeatRuns.contextSnapshot} ->> 'issueId' = ${issueId}`,
      ),
    )
    .orderBy(
      sql`case when ${heartbeatRuns.status} = 'running' then 0 else 1 end`,
      asc(heartbeatRuns.createdAt),
      asc(heartbeatRuns.id),
    )
    .limit(1)
    .then((rows) => rows[0]?.id ?? null);
}

async function canClaimRun(db: Db, run: typeof heartbeatRuns.$inferSelect) {
  const agentQueue = await db
    .select({
      id: heartbeatRuns.id,
      status: heartbeatRuns.status,
    })
    .from(heartbeatRuns)
    .where(and(eq(heartbeatRuns.agentId, run.agentId), inArray(heartbeatRuns.status, ["queued", "running"])))
    .orderBy(
      sql`case when ${heartbeatRuns.status} = 'running' then 0 else 1 end`,
      asc(heartbeatRuns.createdAt),
      asc(heartbeatRuns.id),
    )
    .limit(1);
  if (agentQueue[0]?.id !== run.id) return false;

  const issueId = deriveIssueId(asRecord(run.contextSnapshot), null);
  if (!issueId) return true;

  const issueQueue = await db
    .select({
      id: heartbeatRuns.id,
      status: heartbeatRuns.status,
    })
    .from(heartbeatRuns)
    .where(
      and(
        eq(heartbeatRuns.companyId, run.companyId),
        inArray(heartbeatRuns.status, ["queued", "running"]),
        sql`${heartbeatRuns.contextSnapshot} ->> 'issueId' = ${issueId}`,
      ),
    )
    .orderBy(
      sql`case when ${heartbeatRuns.status} = 'running' then 0 else 1 end`,
      asc(heartbeatRuns.createdAt),
      asc(heartbeatRuns.id),
    )
    .limit(1);

  return issueQueue[0]?.id === run.id;
}

async function startNextQueuedRunForAgent(env: Env, agentId: string) {
  const db = createDb(env.DB);
  const candidate = await db
    .select()
    .from(heartbeatRuns)
    .where(and(eq(heartbeatRuns.agentId, agentId), eq(heartbeatRuns.status, "queued")))
    .orderBy(asc(heartbeatRuns.createdAt), asc(heartbeatRuns.id))
    .limit(1)
    .then((rows) => rows[0] ?? null);
  if (candidate) {
    await executeHostedHeartbeatRun(env, candidate.id);
  }
}

async function startNextQueuedRunForIssue(env: Env, companyId: string, issueId: string) {
  const db = createDb(env.DB);
  const candidate = await db
    .select()
    .from(heartbeatRuns)
    .where(
      and(
        eq(heartbeatRuns.companyId, companyId),
        eq(heartbeatRuns.status, "queued"),
        sql`${heartbeatRuns.contextSnapshot} ->> 'issueId' = ${issueId}`,
      ),
    )
    .orderBy(asc(heartbeatRuns.createdAt), asc(heartbeatRuns.id))
    .limit(1)
    .then((rows) => rows[0] ?? null);
  if (candidate) {
    await executeHostedHeartbeatRun(env, candidate.id);
  }
}

async function buildRunContext(
  db: Db,
  run: typeof heartbeatRuns.$inferSelect,
) {
  const contextSnapshot = asRecord(run.contextSnapshot) ?? {};
  const issueId = deriveIssueId(contextSnapshot, null);
  const commentId = deriveCommentId(contextSnapshot, null);

  if (!issueId) return contextSnapshot;

  const issue = await db
    .select()
    .from(issues)
    .where(and(eq(issues.id, issueId), eq(issues.companyId, run.companyId)))
    .then((rows) => rows[0] ?? null);
  if (!issue) return contextSnapshot;

  const project = issue.projectId
    ? await db.select().from(projects).where(eq(projects.id, issue.projectId)).then((rows) => rows[0] ?? null)
    : null;
  const goal = issue.goalId
    ? await db.select().from(objectives).where(eq(objectives.id, issue.goalId)).then((rows) => rows[0] ?? null)
    : null;

  const ancestors: Array<typeof issues.$inferSelect> = [];
  let current = issue;
  while (current.parentId) {
    const parent = await db
      .select()
      .from(issues)
      .where(eq(issues.id, current.parentId))
      .then((rows) => rows[0] ?? null);
    if (!parent) break;
    ancestors.unshift(parent);
    current = parent;
  }

  const recentComments = await db
    .select()
    .from(issueComments)
    .where(eq(issueComments.issueId, issue.id))
    .orderBy(sql`${issueComments.createdAt} desc`)
    .limit(20);

  const wakeComment = commentId
    ? await db.select().from(issueComments).where(eq(issueComments.id, commentId)).then((rows) => rows[0] ?? null)
    : null;

  return {
    ...contextSnapshot,
    issueId: issue.id,
    taskId: issue.id,
    issue,
    project,
    goal,
    ancestors,
    recentComments,
    wakeComment,
  };
}

async function updateRuntimeState(
  db: Db,
  input: {
    agentId: string;
    companyId: string;
    adapterType: string;
    runId: string;
    status: string;
    usage?: UsageSummary;
    errorMessage?: string | null;
  },
) {
  const now = new Date().toISOString();
  const existing = await db
    .select()
    .from(agentRuntimeState)
    .where(eq(agentRuntimeState.agentId, input.agentId))
    .then((rows) => rows[0] ?? null);
  const usage = usageTotals(input.usage);

  if (existing) {
    await db
      .update(agentRuntimeState)
      .set({
        lastRunId: input.runId,
        lastRunStatus: input.status,
        totalInputTokens: (existing.totalInputTokens ?? 0) + usage.inputTokens,
        totalOutputTokens: (existing.totalOutputTokens ?? 0) + usage.outputTokens,
        totalCachedInputTokens: (existing.totalCachedInputTokens ?? 0) + usage.cachedInputTokens,
        lastError: input.errorMessage ?? null,
        updatedAt: now,
      })
      .where(eq(agentRuntimeState.agentId, input.agentId));
    return;
  }

  await db.insert(agentRuntimeState).values({
    agentId: input.agentId,
    companyId: input.companyId,
    adapterType: input.adapterType,
    sessionId: null,
    stateJson: {},
    lastRunId: input.runId,
    lastRunStatus: input.status,
    totalInputTokens: usage.inputTokens,
    totalOutputTokens: usage.outputTokens,
    totalCachedInputTokens: usage.cachedInputTokens,
    totalCostCents: 0,
    lastError: input.errorMessage ?? null,
    createdAt: now,
    updatedAt: now,
  });
}

export async function enqueueHostedHeartbeatRun(
  input: QueueHostedHeartbeatInput,
) {
  const { db, env, executionCtx, agentId } = input;
  const agent = await getAgent(db, agentId);
  if (!agent) return null;

  const now = new Date().toISOString();
  const source = normalizeWakeupSource(input.source);
  const triggerDetail = normalizeTriggerDetail(input.triggerDetail);
  const reason = input.reason ?? null;
  const payload = input.payload ?? null;
  const contextSnapshot = enrichContextSnapshot({
    source,
    triggerDetail,
    reason,
    payload,
    contextSnapshot: { ...(input.contextSnapshot ?? {}) },
  });

  const unsupported =
    agent.status === "paused" ||
    agent.status === "terminated" ||
    agent.status === "pending_approval" ||
    agent.adapterType !== "cloudflare_workers_ai";
  if (unsupported) {
    await db.insert(agentWakeupRequests).values({
      id: crypto.randomUUID(),
      companyId: agent.companyId,
      agentId,
      source,
      triggerDetail,
      reason: reason ?? "unsupported",
      payload,
      status: "skipped",
      requestedByActorType: input.requestedByActorType ?? null,
      requestedByActorId: input.requestedByActorId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      finishedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return null;
  }

  const wakeupRequestId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const issueId = deriveIssueId(contextSnapshot, payload);
  const activeIssueRunId = issueId ? await getActiveIssueRunId(db, agent.companyId, issueId) : null;

  await db.insert(agentWakeupRequests).values({
    id: wakeupRequestId,
    companyId: agent.companyId,
    agentId,
    source,
    triggerDetail,
    reason,
    payload,
    status: "queued",
    requestedByActorType: input.requestedByActorType ?? null,
    requestedByActorId: input.requestedByActorId ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    runId,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(heartbeatRuns).values({
    id: runId,
    companyId: agent.companyId,
    agentId,
    invocationSource: source,
    triggerDetail,
    status: "queued",
    wakeupRequestId,
    contextSnapshot,
    createdAt: now,
    updatedAt: now,
  });

  if (issueId && !activeIssueRunId) {
    await db
      .update(issues)
      .set({
        executionRunId: runId,
        executionAgentNameKey: normalizeAgentNameKey(agent.name),
        executionLockedAt: now,
        updatedAt: now,
      })
      .where(and(eq(issues.id, issueId), eq(issues.companyId, agent.companyId)));
  }

  executionCtx.waitUntil(executeHostedHeartbeatRun(env, runId));
  return getRun(db, runId);
}

export async function executeHostedHeartbeatRun(env: Env, runId: string) {
  const db = createDb(env.DB);
  let run = await getRun(db, runId);
  if (!run || run.status !== "queued") return run;

  const agent = await getAgent(db, run.agentId);
  if (!agent || agent.adapterType !== "cloudflare_workers_ai") {
    await db
      .update(heartbeatRuns)
      .set({
        status: "failed",
        finishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        error: "Hosted execution is only available for cloudflare_workers_ai agents in Workers runtime",
        errorCode: "hosted_adapter_unsupported",
      })
      .where(eq(heartbeatRuns.id, runId));
    return getRun(db, runId);
  }

  const canStart = await canClaimRun(db, run);
  if (!canStart) return run;

  const startedAt = new Date().toISOString();
  const claimed = await db
    .update(heartbeatRuns)
    .set({
      status: "running",
      startedAt: run.startedAt ?? startedAt,
      updatedAt: startedAt,
    })
    .where(and(eq(heartbeatRuns.id, runId), eq(heartbeatRuns.status, "queued")))
    .returning()
    .then((rows) => rows[0] ?? null);
  if (!claimed) return getRun(db, runId);
  run = claimed;

  if (run.wakeupRequestId) {
    await db
      .update(agentWakeupRequests)
      .set({
        status: "claimed",
        claimedAt: startedAt,
        updatedAt: startedAt,
      })
      .where(eq(agentWakeupRequests.id, run.wakeupRequestId));
  }

  await db
    .update(agents)
    .set({
      status: "running",
      updatedAt: startedAt,
    })
    .where(eq(agents.id, agent.id));

  const issueId = deriveIssueId(asRecord(run.contextSnapshot), null);
  if (issueId) {
    await db
      .update(issues)
      .set({
        executionRunId: run.id,
        executionAgentNameKey: normalizeAgentNameKey(agent.name),
        executionLockedAt: startedAt,
        updatedAt: startedAt,
      })
      .where(and(eq(issues.id, issueId), eq(issues.companyId, run.companyId)));
  }

  let seq = await db
    .select({ maxSeq: sql<number>`coalesce(max(${heartbeatRunEvents.seq}), 0)` })
    .from(heartbeatRunEvents)
    .where(eq(heartbeatRunEvents.runId, run.id))
    .then((rows) => Number(rows[0]?.maxSeq ?? 0));
  let stdoutExcerpt = "";
  let stderrExcerpt = "";

  const nextSeq = () => {
    seq += 1;
    return seq;
  };

  const onMeta = async (meta: AdapterInvocationMeta) => {
    await insertRunEvent(db, {
      companyId: run.companyId,
      runId: run.id,
      agentId: run.agentId,
      nextSeq: nextSeq(),
      eventType: "adapter.invoke",
      stream: "system",
      level: "info",
      message: meta.command,
      payload: meta as unknown as Record<string, unknown>,
    });
  };

  const onLog = async (stream: "stdout" | "stderr", chunk: string) => {
    if (stream === "stdout") {
      stdoutExcerpt = `${stdoutExcerpt}${chunk}`.slice(-12_000);
    } else {
      stderrExcerpt = `${stderrExcerpt}${chunk}`.slice(-12_000);
    }
    const event = chunkToEvent(stream, chunk);
    await insertRunEvent(db, {
      companyId: run.companyId,
      runId: run.id,
      agentId: run.agentId,
      nextSeq: nextSeq(),
      ...event,
    });
  };

  const context = await buildRunContext(db, run);
  const adapterConfig = {
    ...(asRecord(agent.adapterConfig) ?? {}),
    env: {
      ...workerAdapterEnv(env),
      ...sanitizeAdapterEnv(asRecord(agent.adapterConfig)?.env),
    },
  };

  const result = await executeCloudflareWorkersAi({
    runId: run.id,
    agent: {
      id: agent.id,
      companyId: agent.companyId,
      name: agent.name,
      adapterType: agent.adapterType,
      adapterConfig: agent.adapterConfig,
    },
    runtime: {
      sessionId: null,
      sessionParams: null,
      sessionDisplayId: null,
      taskKey: issueId,
    },
    config: adapterConfig,
    context,
    onMeta,
    onLog,
  });

  const latestRun = await getRun(db, run.id);
  const existingStatus = latestRun?.status ?? run.status;
  const finishedAt = new Date().toISOString();
  const finalStatus = deriveFinalStatus(result, existingStatus);
  const errorMessage = result.errorMessage ?? null;

  await db
    .update(heartbeatRuns)
    .set({
      status: finalStatus,
      finishedAt,
      updatedAt: finishedAt,
      error: errorMessage,
      errorCode: result.errorCode ?? null,
      exitCode: result.exitCode ?? null,
      signal: result.signal ?? null,
      usageJson: (result.usage ?? null) as Record<string, unknown> | null,
      resultJson: result.resultJson ?? null,
      stdoutExcerpt: stdoutExcerpt || null,
      stderrExcerpt: stderrExcerpt || null,
      externalRunId: nonEmpty(asRecord(result.resultJson)?.id) ?? null,
    })
    .where(eq(heartbeatRuns.id, run.id));

  if (run.wakeupRequestId) {
    await db
      .update(agentWakeupRequests)
      .set({
        status:
          finalStatus === "cancelled"
            ? "cancelled"
            : finalStatus === "succeeded"
              ? "completed"
              : "failed",
        finishedAt,
        error: errorMessage,
        updatedAt: finishedAt,
      })
      .where(eq(agentWakeupRequests.id, run.wakeupRequestId));
  }

  await db
    .update(agents)
    .set({
      status: finalStatus === "succeeded" ? "idle" : finalStatus === "cancelled" ? "idle" : "error",
      lastHeartbeatAt: finishedAt,
      updatedAt: finishedAt,
    })
    .where(eq(agents.id, agent.id));

  await updateRuntimeState(db, {
    agentId: agent.id,
    companyId: agent.companyId,
    adapterType: agent.adapterType ?? "cloudflare_workers_ai",
    runId: run.id,
    status: finalStatus,
    usage: result.usage,
    errorMessage,
  });

  if (issueId) {
    await db
      .update(issues)
      .set({
        executionRunId: null,
        executionLockedAt: null,
        executionAgentNameKey: null,
        updatedAt: finishedAt,
      })
      .where(and(eq(issues.id, issueId), eq(issues.executionRunId, run.id)));
  }

  await startNextQueuedRunForAgent(env, agent.id);
  if (issueId) {
    await startNextQueuedRunForIssue(env, run.companyId, issueId);
  }

  return getRun(db, run.id);
}

export async function readInlineHeartbeatRunLog(
  db: Db,
  runId: string,
  offset: number,
  limitBytes: number,
) {
  const rows = await db
    .select()
    .from(heartbeatRunEvents)
    .where(eq(heartbeatRunEvents.runId, runId))
    .orderBy(asc(heartbeatRunEvents.seq));

  const content = rows
    .map((row) => {
      const payload = asRecord(row.payload);
      const chunk = nonEmpty(payload?.rawChunk) ?? nonEmpty(row.message) ?? "";
      if (!chunk) return "";
      return `${JSON.stringify({
        ts: row.createdAt,
        stream: row.stream ?? "stdout",
        chunk,
      })}\n`;
    })
    .join("");

  const start = Math.max(0, offset);
  const end = Math.min(content.length, start + Math.max(0, limitBytes));
  return {
    runId,
    store: "inline_events",
    logRef: `heartbeat-run:${runId}:events`,
    content: content.slice(start, end),
    ...(end < content.length ? { nextOffset: end } : {}),
  };
}
