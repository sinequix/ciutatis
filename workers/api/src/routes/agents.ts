import { Hono } from "hono";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { models as cloudflareWorkersAiModels } from "@ciutatis/adapter-cloudflare-workers-ai";
import { testEnvironment as testCloudflareWorkersAiEnvironment } from "@ciutatis/adapter-cloudflare-workers-ai/workers";
import {
  agents,
  companies,
  heartbeatRuns,
  heartbeatRunEvents,
  agentApiKeys,
  agentConfigRevisions,
  agentRuntimeState,
  agentTaskSessions,
  approvals,
  issues,
  principalPermissionGrants,
  workspaceOperations,
} from "@ciutatis/db-cloudflare";
import { isUuidLike, normalizeAgentUrlKey } from "@paperclipai/shared";
import type { AppContext, AppEnv } from "../lib/types.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "../lib/authz.js";
import { notFound, forbidden, conflict, unprocessable, badRequest } from "../lib/errors.js";
import { logActivity } from "../lib/activity.js";
import { hashToken } from "../lib/crypto.js";
import { resolveIssueByRef } from "../lib/issues.js";
import { enqueueHostedHeartbeatRun, readInlineHeartbeatRunLog } from "../lib/hosted-heartbeats.js";
import { sanitizeRecord } from "../lib/sanitize.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseBooleanLike(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1 ? true : value === 0 ? false : null;
  if (typeof value !== "string") return null;
  const n = value.trim().toLowerCase();
  if (n === "true" || n === "1" || n === "yes" || n === "on") return true;
  if (n === "false" || n === "0" || n === "no" || n === "off") return false;
  return null;
}

function parseNumberLike(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const p = Number(value.trim());
  return Number.isFinite(p) ? p : null;
}

function parseSchedulerHeartbeatPolicy(runtimeConfig: unknown) {
  const heartbeat = asRecord(asRecord(runtimeConfig)?.heartbeat) ?? {};
  return {
    enabled: parseBooleanLike(heartbeat.enabled) ?? true,
    intervalSec: Math.max(0, parseNumberLike(heartbeat.intervalSec) ?? 0),
  };
}

function redactPayload(obj: unknown): Record<string, unknown> {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  return sanitizeRecord(obj as Record<string, unknown>);
}

function toLeanOrgNode(node: Record<string, unknown>): Record<string, unknown> {
  const reports = Array.isArray(node.reports)
    ? (node.reports as Array<Record<string, unknown>>).map(toLeanOrgNode)
    : [];
  return {
    id: String(node.id),
    name: String(node.name),
    role: String(node.role),
    status: String(node.status),
    reports,
  };
}

function normalizeAgentPermissions(permissions: unknown, role: string) {
  if (typeof permissions !== "object" || permissions === null || Array.isArray(permissions)) {
    return { canCreateAgents: role === "ceo" };
  }

  const record = permissions as Record<string, unknown>;
  return {
    canCreateAgents:
      typeof record.canCreateAgents === "boolean"
        ? record.canCreateAgents
        : role === "ceo",
  };
}

function canCreateAgents(agent: { role: string; permissions: unknown }) {
  if (!agent.permissions || typeof agent.permissions !== "object") return false;
  return Boolean((agent.permissions as Record<string, unknown>).canCreateAgents);
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

function workerAdapterEnv(c: AppContext): Record<string, string> {
  const env: Record<string, string> = {};
  if (typeof c.env.CLOUDFLARE_ACCOUNT_ID === "string" && c.env.CLOUDFLARE_ACCOUNT_ID.trim()) {
    env.CLOUDFLARE_ACCOUNT_ID = c.env.CLOUDFLARE_ACCOUNT_ID.trim();
  }
  if (typeof c.env.CLOUDFLARE_API_TOKEN === "string" && c.env.CLOUDFLARE_API_TOKEN.trim()) {
    env.CLOUDFLARE_API_TOKEN = c.env.CLOUDFLARE_API_TOKEN.trim();
  }
  return env;
}

async function hasPermissionGrant(
  c: AppContext,
  companyId: string,
  principalType: "user" | "agent",
  principalId: string,
  permissionKey: string,
) {
  const db = c.get("db");
  const grant = await db
    .select({ companyId: principalPermissionGrants.companyId })
    .from(principalPermissionGrants)
    .where(
      and(
        eq(principalPermissionGrants.companyId, companyId),
        eq(principalPermissionGrants.principalType, principalType),
        eq(principalPermissionGrants.principalId, principalId),
        eq(principalPermissionGrants.permissionKey, permissionKey),
      ),
    )
    .then((rows) => rows[0] ?? null);
  return Boolean(grant);
}

async function assertCanReadConfigurations(c: AppContext, companyId: string) {
  assertCompanyAccess(c, companyId);
  const actor = c.get("actor");
  if (actor.type === "board") {
    if (actor.source === "local_implicit" || actor.isInstanceAdmin) return;
    const allowed = await hasPermissionGrant(c, companyId, "user", actor.userId, "agents:create");
    if (!allowed) throw forbidden("Missing permission: agents:create");
    return;
  }
  if (actor.type !== "agent" || !actor.agentId) {
    throw forbidden("Board or permitted agent authentication required");
  }
  const db = c.get("db");
  const actorAgent = await db
    .select({
      id: agents.id,
      companyId: agents.companyId,
      role: agents.role,
      permissions: agents.permissions,
    })
    .from(agents)
    .where(eq(agents.id, actor.agentId))
    .then((rows) => rows[0] ?? null);
  if (!actorAgent || actorAgent.companyId !== companyId) {
    throw forbidden("Agent key cannot access another company");
  }
  const allowedByGrant = await hasPermissionGrant(c, companyId, "agent", actorAgent.id, "agents:create");
  if (!allowedByGrant && !canCreateAgents(actorAgent)) {
    throw forbidden("Missing permission: can create agents");
  }
}

function toAgentResponse<T extends { id: string; name: string; role: string; permissions: unknown }>(row: T) {
  return {
    ...row,
    urlKey: normalizeAgentUrlKey(row.name) ?? row.id,
    permissions: normalizeAgentPermissions(row.permissions, row.role),
  };
}

async function resolveCompanyIdForAgentReference(c: Parameters<typeof assertBoard>[0]): Promise<string | null> {
  const companyIdQuery = c.req.query("companyId");
  const requestedCompanyId = typeof companyIdQuery === "string" && companyIdQuery.trim().length > 0
    ? companyIdQuery.trim()
    : null;
  if (requestedCompanyId) {
    assertCompanyAccess(c, requestedCompanyId);
    return requestedCompanyId;
  }
  const actor = c.get("actor");
  if (actor.type === "agent" && actor.companyId) {
    return actor.companyId;
  }
  return null;
}

async function resolveAgentId(c: Parameters<typeof assertBoard>[0], rawId: string) {
  const raw = rawId.trim();
  if (isUuidLike(raw)) return raw;

  const companyId = await resolveCompanyIdForAgentReference(c);
  if (!companyId) {
    throw unprocessable("Agent shortname lookup requires companyId query parameter");
  }

  const urlKey = normalizeAgentUrlKey(raw);
  if (!urlKey) throw notFound("Agent not found");

  const db = c.get("db");
  const rows = await db.select().from(agents).where(eq(agents.companyId, companyId));
  const matches = rows.filter(
    (agent) => agent.status !== "terminated" && normalizeAgentUrlKey(agent.name) === urlKey,
  );
  if (matches.length > 1) {
    throw conflict("Agent shortname is ambiguous in this company. Use the agent ID.");
  }
  const match = matches[0];
  if (!match) throw notFound("Agent not found");
  return match.id;
}

export function agentRoutes() {
  const app = new Hono<AppEnv>();

  app.get("/companies/:companyId/adapters/:type/models", async (c) => {
    assertCompanyAccess(c, c.req.param("companyId")!);
    const type = c.req.param("type")!;
    if (type === "cloudflare_workers_ai") {
      return c.json(cloudflareWorkersAiModels);
    }
    return c.json([]);
  });

  app.post("/companies/:companyId/adapters/:type/test-environment", async (c) => {
    const companyId = c.req.param("companyId")!;
    const type = c.req.param("type")!;
    await assertCanReadConfigurations(c, companyId);

    if (type !== "cloudflare_workers_ai") {
      return c.json({ error: `Unknown adapter type: ${type}` }, 404);
    }

    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const adapterConfig = asRecord(body.adapterConfig) ?? {};
    const requestEnv = sanitizeAdapterEnv(adapterConfig.env);
    const result = await testCloudflareWorkersAiEnvironment({
      companyId,
      adapterType: type,
      config: {
        ...adapterConfig,
        env: {
          ...workerAdapterEnv(c),
          ...requestEnv,
        },
      },
    });

    return c.json(result);
  });

  // GET /companies/:companyId/agents
  app.get("/companies/:companyId/agents", async (c) => {
    const db = c.get("db");
    const companyId = c.req.param("companyId")!;
    assertCompanyAccess(c, companyId);
    const rows = await db.select().from(agents).where(eq(agents.companyId, companyId)).orderBy(agents.name);
    return c.json(rows.map(toAgentResponse));
  });

  // GET /instance/scheduler-heartbeats
  app.get("/instance/scheduler-heartbeats", async (c) => {
    const db = c.get("db");
    assertBoard(c);
    const actor = c.get("actor");

    let rows;
    if (actor.source !== "local_implicit" && !(actor.type === "board" && actor.isInstanceAdmin)) {
      const allowed = (actor.type === "board" ? actor.companyIds : undefined) ?? [];
      if (allowed.length === 0) return c.json([]);
      rows = await db
        .select({
          id: agents.id,
          companyId: agents.companyId,
          agentName: agents.name,
          role: agents.role,
          title: agents.title,
          status: agents.status,
          adapterType: agents.adapterType,
          runtimeConfig: agents.runtimeConfig,
          lastHeartbeatAt: agents.lastHeartbeatAt,
          companyName: companies.name,
          companyIssuePrefix: companies.issuePrefix,
        })
        .from(agents)
        .innerJoin(companies, eq(agents.companyId, companies.id))
        .where(inArray(agents.companyId, allowed))
        .orderBy(companies.name, agents.name);
    } else {
      rows = await db
        .select({
          id: agents.id,
          companyId: agents.companyId,
          agentName: agents.name,
          role: agents.role,
          title: agents.title,
          status: agents.status,
          adapterType: agents.adapterType,
          runtimeConfig: agents.runtimeConfig,
          lastHeartbeatAt: agents.lastHeartbeatAt,
          companyName: companies.name,
          companyIssuePrefix: companies.issuePrefix,
        })
        .from(agents)
        .innerJoin(companies, eq(agents.companyId, companies.id))
        .orderBy(companies.name, agents.name);
    }

    const items = rows
      .map((row) => {
        const policy = parseSchedulerHeartbeatPolicy(row.runtimeConfig);
        const statusEligible =
          row.status !== "paused" && row.status !== "terminated" && row.status !== "pending_approval";
        return {
          id: row.id,
          companyId: row.companyId,
          companyName: row.companyName,
          companyIssuePrefix: row.companyIssuePrefix,
          agentName: row.agentName,
          role: row.role,
          title: row.title,
          status: row.status,
          adapterType: row.adapterType,
          intervalSec: policy.intervalSec,
          heartbeatEnabled: policy.enabled,
          schedulerActive: statusEligible && policy.enabled && policy.intervalSec > 0,
          lastHeartbeatAt: row.lastHeartbeatAt,
        };
      })
      .filter(
        (item) =>
          item.intervalSec > 0 &&
          item.status !== "paused" &&
          item.status !== "terminated" &&
          item.status !== "pending_approval",
      )
      .sort((a, b) => {
        if (a.schedulerActive !== b.schedulerActive) return a.schedulerActive ? -1 : 1;
        return a.companyName.localeCompare(b.companyName) || a.agentName.localeCompare(b.agentName);
      });

    return c.json(items);
  });

  // GET /companies/:companyId/org
  app.get("/companies/:companyId/org", async (c) => {
    const db = c.get("db");
    const companyId = c.req.param("companyId")!;
    assertCompanyAccess(c, companyId);
    const rows = await db.select().from(agents).where(eq(agents.companyId, companyId)).orderBy(agents.name);
    const byId = new Map(rows.map((r) => [r.id, { ...r, reports: [] as typeof rows }]));
    const roots: typeof rows = [];
    for (const row of rows) {
      if (row.reportsTo && byId.has(row.reportsTo)) {
        byId.get(row.reportsTo)!.reports.push(row);
      } else {
        roots.push(row);
      }
    }
    function buildTree(node: (typeof rows)[0]): Record<string, unknown> {
      const entry = byId.get(node.id)!;
      return {
        id: node.id,
        name: node.name,
        role: node.role,
        status: node.status,
        reports: entry.reports.map(buildTree),
      };
    }
    return c.json(roots.map(buildTree));
  });

  // GET /companies/:companyId/agent-configurations
  app.get("/companies/:companyId/agent-configurations", async (c) => {
    const db = c.get("db");
    const companyId = c.req.param("companyId")!;
    assertCompanyAccess(c, companyId);
    const rows = await db.select().from(agents).where(eq(agents.companyId, companyId));
    return c.json(
      rows.map((r) => ({
        id: r.id,
        companyId: r.companyId,
        name: r.name,
        role: r.role,
        title: r.title,
        status: r.status,
        reportsTo: r.reportsTo,
        adapterType: r.adapterType,
        adapterConfig: redactPayload(r.adapterConfig),
        runtimeConfig: redactPayload(r.runtimeConfig),
        permissions: r.permissions,
        updatedAt: r.updatedAt,
      })),
    );
  });

  // GET /agents/me
  app.get("/agents/me", async (c) => {
    const db = c.get("db");
    const actor = c.get("actor");
    if (actor.type !== "agent" || !actor.agentId) return c.json({ error: "Agent authentication required" }, 401);
    const agent = await db.select().from(agents).where(eq(agents.id, actor.agentId)).then((r: any[]) => r[0] ?? null);
    if (!agent) throw notFound("Agent not found");
    return c.json(toAgentResponse(agent));
  });

  // GET /agents/me/inbox-lite
  app.get("/agents/me/inbox-lite", async (c) => {
    const db = c.get("db");
    const actor = c.get("actor");
    if (actor.type !== "agent" || !actor.agentId || !actor.companyId)
      return c.json({ error: "Agent authentication required" }, 401);
    const rows = await db
      .select()
      .from(issues)
      .where(
        and(
          eq(issues.companyId, actor.companyId),
          eq(issues.assigneeAgentId, actor.agentId),
          inArray(issues.status, ["todo", "in_progress", "blocked"]),
        ),
      )
      .orderBy(desc(issues.updatedAt));
    return c.json(
      rows.map((r) => ({
        id: r.id,
        identifier: r.identifier,
        title: r.title,
        status: r.status,
        priority: r.priority,
        projectId: r.projectId,
        goalId: r.goalId,
        parentId: r.parentId,
        updatedAt: r.updatedAt,
      })),
    );
  });

  // GET /agents/:id
  app.get("/agents/:id", async (c) => {
    const db = c.get("db");
    const id = await resolveAgentId(c, c.req.param("id")!);
    const agent = await db.select().from(agents).where(eq(agents.id, id)).then((r: any[]) => r[0] ?? null);
    if (!agent) throw notFound("Agent not found");
    assertCompanyAccess(c, agent.companyId);
    return c.json(toAgentResponse(agent));
  });

  // GET /agents/:id/configuration
  app.get("/agents/:id/configuration", async (c) => {
    const db = c.get("db");
    const id = c.req.param("id")!;
    const agent = await db.select().from(agents).where(eq(agents.id, id)).then((r: any[]) => r[0] ?? null);
    if (!agent) throw notFound("Agent not found");
    assertCompanyAccess(c, agent.companyId);
    return c.json({
      id: agent.id,
      companyId: agent.companyId,
      name: agent.name,
      role: agent.role,
      title: agent.title,
      status: agent.status,
      reportsTo: agent.reportsTo,
      adapterType: agent.adapterType,
      adapterConfig: redactPayload(agent.adapterConfig),
      runtimeConfig: redactPayload(agent.runtimeConfig),
      permissions: agent.permissions,
      updatedAt: agent.updatedAt,
    });
  });

  // GET /agents/:id/config-revisions
  app.get("/agents/:id/config-revisions", async (c) => {
    const db = c.get("db");
    const id = c.req.param("id")!;
    const agent = await db.select().from(agents).where(eq(agents.id, id)).then((r: any[]) => r[0] ?? null);
    if (!agent) throw notFound("Agent not found");
    assertCompanyAccess(c, agent.companyId);
    const revisions = await db
      .select()
      .from(agentConfigRevisions)
      .where(eq(agentConfigRevisions.agentId, id))
      .orderBy(desc(agentConfigRevisions.createdAt));
    return c.json(
      revisions.map((r) => ({
        ...r,
        beforeConfig: redactPayload(r.beforeConfig),
        afterConfig: redactPayload(r.afterConfig),
      })),
    );
  });

  // GET /agents/:id/config-revisions/:revisionId
  app.get("/agents/:id/config-revisions/:revisionId", async (c) => {
    const db = c.get("db");
    const id = c.req.param("id")!;
    const revisionId = c.req.param("revisionId")!;
    const agent = await db.select().from(agents).where(eq(agents.id, id)).then((r: any[]) => r[0] ?? null);
    if (!agent) throw notFound("Agent not found");
    assertCompanyAccess(c, agent.companyId);
    const revision = await db
      .select()
      .from(agentConfigRevisions)
      .where(and(eq(agentConfigRevisions.agentId, id), eq(agentConfigRevisions.id, revisionId)))
      .then((r: any[]) => r[0] ?? null);
    if (!revision) throw notFound("Revision not found");
    return c.json({
      ...revision,
      beforeConfig: redactPayload(revision.beforeConfig),
      afterConfig: redactPayload(revision.afterConfig),
    });
  });

  // POST /agents/:id/config-revisions/:revisionId/rollback
  app.post("/agents/:id/config-revisions/:revisionId/rollback", async (c) => {
    const db = c.get("db");
    const id = c.req.param("id")!;
    const revisionId = c.req.param("revisionId")!;
    const agent = await db.select().from(agents).where(eq(agents.id, id)).then((r: any[]) => r[0] ?? null);
    if (!agent) throw notFound("Agent not found");
    assertCompanyAccess(c, agent.companyId);
    const revision = await db
      .select()
      .from(agentConfigRevisions)
      .where(and(eq(agentConfigRevisions.agentId, id), eq(agentConfigRevisions.id, revisionId)))
      .then((r: any[]) => r[0] ?? null);
    if (!revision) throw notFound("Revision not found");
    const beforeConfig = revision.beforeConfig as Record<string, unknown> | null;
    if (!beforeConfig) throw unprocessable("Revision has no restorable config");
    const now = new Date().toISOString();
    await db.update(agents).set({ ...beforeConfig, updatedAt: now } as any).where(eq(agents.id, id));
    const actorInfo = getActorInfo(c);
    await logActivity(db, {
      companyId: agent.companyId,
      actorType: actorInfo.actorType,
      actorId: actorInfo.actorId,
      agentId: actorInfo.agentId,
      runId: actorInfo.runId,
      action: "agent.config_rolled_back",
      entityType: "agent",
      entityId: id,
      details: { revisionId },
    });
    const updated = await db.select().from(agents).where(eq(agents.id, id)).then((r: any[]) => r[0]);
    return c.json(updated);
  });

  // GET /agents/:id/runtime-state
  app.get("/agents/:id/runtime-state", async (c) => {
    const db = c.get("db");
    assertBoard(c);
    const id = c.req.param("id")!;
    const agent = await db.select().from(agents).where(eq(agents.id, id)).then((r: any[]) => r[0] ?? null);
    if (!agent) throw notFound("Agent not found");
    assertCompanyAccess(c, agent.companyId);
    const state = await db
      .select()
      .from(agentRuntimeState)
      .where(eq(agentRuntimeState.agentId, id))
      .then((r: any[]) => r[0] ?? null);
    return c.json(state);
  });

  // GET /agents/:id/task-sessions
  app.get("/agents/:id/task-sessions", async (c) => {
    const db = c.get("db");
    assertBoard(c);
    const id = c.req.param("id")!;
    const agent = await db.select().from(agents).where(eq(agents.id, id)).then((r: any[]) => r[0] ?? null);
    if (!agent) throw notFound("Agent not found");
    assertCompanyAccess(c, agent.companyId);
    const sessions = await db
      .select()
      .from(agentTaskSessions)
      .where(eq(agentTaskSessions.agentId, id))
      .orderBy(desc(agentTaskSessions.updatedAt));
    return c.json(sessions);
  });

  // POST /agents/:id/runtime-state/reset-session
  app.post("/agents/:id/runtime-state/reset-session", async (c) => {
    const db = c.get("db");
    assertBoard(c);
    const id = c.req.param("id")!;
    const agent = await db.select().from(agents).where(eq(agents.id, id)).then((r: any[]) => r[0] ?? null);
    if (!agent) throw notFound("Agent not found");
    assertCompanyAccess(c, agent.companyId);
    const body = await c.req.json().catch(() => ({}));
    const taskKey = typeof body.taskKey === "string" && body.taskKey.trim().length > 0 ? body.taskKey.trim() : null;
    const now = new Date().toISOString();
    if (taskKey) {
      await db
        .update(agentTaskSessions)
        .set({ updatedAt: now })
        .where(and(eq(agentTaskSessions.agentId, id), eq(agentTaskSessions.taskKey, taskKey)));
    } else {
      await db
        .update(agentRuntimeState)
        .set({ sessionId: null, updatedAt: now })
        .where(eq(agentRuntimeState.agentId, id));
    }
    const actorInfo = getActorInfo(c);
    await logActivity(db, {
      companyId: agent.companyId,
      actorType: "user",
      actorId: actorInfo.actorId,
      action: "agent.runtime_session_reset",
      entityType: "agent",
      entityId: id,
      details: { taskKey },
    });
    const state = await db
      .select()
      .from(agentRuntimeState)
      .where(eq(agentRuntimeState.agentId, id))
      .then((r: any[]) => r[0] ?? null);
    return c.json(state);
  });

  // POST /companies/:companyId/agent-hires
  app.post("/companies/:companyId/agent-hires", async (c) => {
    const db = c.get("db");
    const companyId = c.req.param("companyId")!;
    assertCompanyAccess(c, companyId);
    const body = await c.req.json();
    const company = await db.select().from(companies).where(eq(companies.id, companyId)).then((r: any[]) => r[0] ?? null);
    if (!company) throw notFound("Company not found");
    const requiresApproval = company.requireBoardApprovalForNewAgents;
    const status = requiresApproval ? "pending_approval" : "idle";
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.insert(agents).values({
      id,
      companyId,
      name: body.name,
      role: body.role ?? "worker",
      title: body.title ?? null,
      icon: body.icon ?? null,
      reportsTo: body.reportsTo ?? null,
      adapterType: body.adapterType ?? null,
      adapterConfig: body.adapterConfig ?? {},
      runtimeConfig: body.runtimeConfig ?? {},
      capabilities: body.capabilities ?? null,
      permissions: body.permissions ?? null,
      metadata: body.metadata ?? null,
      status,
      budgetMonthlyCents: body.budgetMonthlyCents ?? 0,
      spentMonthlyCents: 0,
      lastHeartbeatAt: null,
      createdAt: now,
      updatedAt: now,
    });
    const agent = await db.select().from(agents).where(eq(agents.id, id)).then((r: any[]) => r[0]);
    const actorInfo = getActorInfo(c);
    if (requiresApproval) {
      const approvalId = crypto.randomUUID();
      await db.insert(approvals).values({
        id: approvalId,
        companyId,
        type: "hire_agent",
        requestedByAgentId: actorInfo.actorType === "agent" ? actorInfo.actorId : null,
        requestedByUserId: actorInfo.actorType === "user" ? actorInfo.actorId : null,
        status: "pending",
        payload: { agentId: id, name: body.name, role: body.role },
        createdAt: now,
        updatedAt: now,
      });
    }
    await logActivity(db, {
      companyId,
      actorType: actorInfo.actorType,
      actorId: actorInfo.actorId,
      agentId: actorInfo.agentId,
      runId: actorInfo.runId,
      action: requiresApproval ? "agent.hire_requested" : "agent.created",
      entityType: "agent",
      entityId: id,
      details: { name: body.name, role: body.role, status },
    });
    return c.json(agent, 201);
  });

  // POST /companies/:companyId/agents
  app.post("/companies/:companyId/agents", async (c) => {
    const db = c.get("db");
    const companyId = c.req.param("companyId")!;
    assertCompanyAccess(c, companyId);
    const body = await c.req.json();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.insert(agents).values({
      id,
      companyId,
      name: body.name,
      role: body.role ?? "worker",
      title: body.title ?? null,
      icon: body.icon ?? null,
      reportsTo: body.reportsTo ?? null,
      adapterType: body.adapterType ?? null,
      adapterConfig: body.adapterConfig ?? {},
      runtimeConfig: body.runtimeConfig ?? {},
      capabilities: body.capabilities ?? null,
      permissions: body.permissions ?? null,
      metadata: body.metadata ?? null,
      status: "idle",
      budgetMonthlyCents: body.budgetMonthlyCents ?? 0,
      spentMonthlyCents: 0,
      lastHeartbeatAt: null,
      createdAt: now,
      updatedAt: now,
    });
    const agent = await db.select().from(agents).where(eq(agents.id, id)).then((r: any[]) => r[0]);
    const actorInfo = getActorInfo(c);
    await logActivity(db, {
      companyId,
      actorType: actorInfo.actorType,
      actorId: actorInfo.actorId,
      agentId: actorInfo.agentId,
      runId: actorInfo.runId,
      action: "agent.created",
      entityType: "agent",
      entityId: id,
      details: { name: body.name, role: body.role },
    });
    return c.json(agent, 201);
  });

  // PATCH /agents/:id/permissions
  app.patch("/agents/:id/permissions", async (c) => {
    const db = c.get("db");
    const id = c.req.param("id")!;
    const body = await c.req.json();
    const agent = await db.select().from(agents).where(eq(agents.id, id)).then((r: any[]) => r[0] ?? null);
    if (!agent) throw notFound("Agent not found");
    assertCompanyAccess(c, agent.companyId);
    const now = new Date().toISOString();
    await db.update(agents).set({ permissions: body.permissions ?? null, updatedAt: now }).where(eq(agents.id, id));
    const actorInfo = getActorInfo(c);
    await logActivity(db, {
      companyId: agent.companyId,
      actorType: actorInfo.actorType,
      actorId: actorInfo.actorId,
      agentId: actorInfo.agentId,
      runId: actorInfo.runId,
      action: "agent.permissions_updated",
      entityType: "agent",
      entityId: id,
    });
    const updated = await db.select().from(agents).where(eq(agents.id, id)).then((r: any[]) => r[0]);
    return c.json(updated);
  });

  // PATCH /agents/:id/instructions-path
  app.patch("/agents/:id/instructions-path", async (c) => {
    const db = c.get("db");
    const id = c.req.param("id")!;
    const body = await c.req.json();
    const agent = await db.select().from(agents).where(eq(agents.id, id)).then((r: any[]) => r[0] ?? null);
    if (!agent) throw notFound("Agent not found");
    assertCompanyAccess(c, agent.companyId);
    const now = new Date().toISOString();
    const adapterConfig = { ...(agent.adapterConfig as Record<string, unknown> ?? {}), instructionsFilePath: body.path ?? null };
    await db.update(agents).set({ adapterConfig, updatedAt: now }).where(eq(agents.id, id));
    const actorInfo = getActorInfo(c);
    await logActivity(db, {
      companyId: agent.companyId,
      actorType: actorInfo.actorType,
      actorId: actorInfo.actorId,
      agentId: actorInfo.agentId,
      runId: actorInfo.runId,
      action: "agent.instructions_path_updated",
      entityType: "agent",
      entityId: id,
    });
    const updated = await db.select().from(agents).where(eq(agents.id, id)).then((r: any[]) => r[0]);
    return c.json(updated);
  });

  // PATCH /agents/:id
  app.patch("/agents/:id", async (c) => {
    const db = c.get("db");
    const id = c.req.param("id")!;
    const body = await c.req.json();
    const agent = await db.select().from(agents).where(eq(agents.id, id)).then((r: any[]) => r[0] ?? null);
    if (!agent) throw notFound("Agent not found");
    assertCompanyAccess(c, agent.companyId);
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { updatedAt: now };
    const allowedFields = [
      "name", "role", "title", "icon", "reportsTo", "adapterType",
      "adapterConfig", "runtimeConfig", "capabilities", "permissions",
      "metadata", "budgetMonthlyCents", "status",
    ];
    for (const field of allowedFields) {
      if (field in body) patch[field] = body[field];
    }
    if (body.adapterConfig && typeof body.adapterConfig === "object") {
      patch.adapterConfig = { ...(agent.adapterConfig as Record<string, unknown> ?? {}), ...body.adapterConfig };
    }
    if (body.runtimeConfig && typeof body.runtimeConfig === "object") {
      patch.runtimeConfig = { ...(agent.runtimeConfig as Record<string, unknown> ?? {}), ...body.runtimeConfig };
    }
    const beforeSnapshot = {
      adapterConfig: agent.adapterConfig,
      runtimeConfig: agent.runtimeConfig,
      name: agent.name,
      role: agent.role,
      title: agent.title,
      status: agent.status,
    };
    await db.update(agents).set(patch as any).where(eq(agents.id, id));
    const updated = await db.select().from(agents).where(eq(agents.id, id)).then((r: any[]) => r[0]);
    const actorForRevision = c.get("actor");
    await db.insert(agentConfigRevisions).values({
      companyId: agent.companyId,
      agentId: id,
      createdByAgentId: actorForRevision.type === "agent" ? actorForRevision.agentId : null,
      createdByUserId: actorForRevision.type === "board" ? actorForRevision.userId : null,
      source: "patch",
      beforeConfig: beforeSnapshot as Record<string, unknown>,
      afterConfig: patch as Record<string, unknown>,
      changedKeys: Object.keys(patch),
    });
    const actorInfo = getActorInfo(c);
    await logActivity(db, {
      companyId: agent.companyId,
      actorType: actorInfo.actorType,
      actorId: actorInfo.actorId,
      agentId: actorInfo.agentId,
      runId: actorInfo.runId,
      action: "agent.updated",
      entityType: "agent",
      entityId: id,
      details: { changedTopLevelKeys: Object.keys(patch).filter((k) => k !== "updatedAt").sort() },
    });
    return c.json(updated);
  });

  // POST /agents/:id/pause
  app.post("/agents/:id/pause", async (c) => {
    const db = c.get("db");
    const id = c.req.param("id")!;
    const agent = await db.select().from(agents).where(eq(agents.id, id)).then((r: any[]) => r[0] ?? null);
    if (!agent) throw notFound("Agent not found");
    assertCompanyAccess(c, agent.companyId);
    const now = new Date().toISOString();
    await db.update(agents).set({ status: "paused", updatedAt: now }).where(eq(agents.id, id));
    const actorInfo = getActorInfo(c);
    await logActivity(db, {
      companyId: agent.companyId,
      actorType: actorInfo.actorType,
      actorId: actorInfo.actorId,
      agentId: actorInfo.agentId,
      runId: actorInfo.runId,
      action: "agent.paused",
      entityType: "agent",
      entityId: id,
    });
    const updated = await db.select().from(agents).where(eq(agents.id, id)).then((r: any[]) => r[0]);
    return c.json(updated);
  });

  // POST /agents/:id/resume
  app.post("/agents/:id/resume", async (c) => {
    const db = c.get("db");
    const id = c.req.param("id")!;
    const agent = await db.select().from(agents).where(eq(agents.id, id)).then((r: any[]) => r[0] ?? null);
    if (!agent) throw notFound("Agent not found");
    assertCompanyAccess(c, agent.companyId);
    const now = new Date().toISOString();
    await db.update(agents).set({ status: "idle", updatedAt: now }).where(eq(agents.id, id));
    const actorInfo = getActorInfo(c);
    await logActivity(db, {
      companyId: agent.companyId,
      actorType: actorInfo.actorType,
      actorId: actorInfo.actorId,
      agentId: actorInfo.agentId,
      runId: actorInfo.runId,
      action: "agent.resumed",
      entityType: "agent",
      entityId: id,
    });
    const updated = await db.select().from(agents).where(eq(agents.id, id)).then((r: any[]) => r[0]);
    return c.json(updated);
  });

  // POST /agents/:id/terminate
  app.post("/agents/:id/terminate", async (c) => {
    const db = c.get("db");
    const id = c.req.param("id")!;
    const agent = await db.select().from(agents).where(eq(agents.id, id)).then((r: any[]) => r[0] ?? null);
    if (!agent) throw notFound("Agent not found");
    assertCompanyAccess(c, agent.companyId);
    const now = new Date().toISOString();
    await db.update(agents).set({ status: "terminated", updatedAt: now }).where(eq(agents.id, id));
    const actorInfo = getActorInfo(c);
    await logActivity(db, {
      companyId: agent.companyId,
      actorType: actorInfo.actorType,
      actorId: actorInfo.actorId,
      agentId: actorInfo.agentId,
      runId: actorInfo.runId,
      action: "agent.terminated",
      entityType: "agent",
      entityId: id,
    });
    const updated = await db.select().from(agents).where(eq(agents.id, id)).then((r: any[]) => r[0]);
    return c.json(updated);
  });

  // DELETE /agents/:id
  app.delete("/agents/:id", async (c) => {
    const db = c.get("db");
    const id = c.req.param("id")!;
    const agent = await db.select().from(agents).where(eq(agents.id, id)).then((r: any[]) => r[0] ?? null);
    if (!agent) throw notFound("Agent not found");
    assertCompanyAccess(c, agent.companyId);
    await db.delete(agents).where(eq(agents.id, id));
    const actorInfo = getActorInfo(c);
    await logActivity(db, {
      companyId: agent.companyId,
      actorType: actorInfo.actorType,
      actorId: actorInfo.actorId,
      agentId: actorInfo.agentId,
      runId: actorInfo.runId,
      action: "agent.deleted",
      entityType: "agent",
      entityId: id,
    });
    return c.json({ success: true });
  });

  // GET /agents/:id/keys
  app.get("/agents/:id/keys", async (c) => {
    const db = c.get("db");
    const id = c.req.param("id")!;
    const rows = await db.select().from(agentApiKeys).where(eq(agentApiKeys.agentId, id)).orderBy(desc(agentApiKeys.createdAt));
    return c.json(rows.map((k) => ({ ...k, keyHash: undefined })));
  });

  // POST /agents/:id/keys
  app.post("/agents/:id/keys", async (c) => {
    const db = c.get("db");
    const id = c.req.param("id")!;
    const agent = await db.select().from(agents).where(eq(agents.id, id)).then((r: any[]) => r[0] ?? null);
    if (!agent) throw notFound("Agent not found");
    assertCompanyAccess(c, agent.companyId);
    const body = await c.req.json().catch(() => ({}));
    const rawToken = `pcp_${crypto.randomUUID().replace(/-/g, "")}`;
    const keyHash = await hashToken(rawToken);
    const now = new Date().toISOString();
    await db.insert(agentApiKeys).values({
      agentId: id,
      companyId: agent.companyId,
      name: body.label ?? "API Key",
      keyHash,
    });
    const inserted = await db.select().from(agentApiKeys).where(eq(agentApiKeys.keyHash, keyHash)).then((r: any[]) => r[0]);
    const newKeyId = inserted?.id;
    const actorInfo = getActorInfo(c);
    await logActivity(db, {
      companyId: agent.companyId,
      actorType: actorInfo.actorType,
      actorId: actorInfo.actorId,
      agentId: actorInfo.agentId,
      runId: actorInfo.runId,
      action: "agent.key_created",
      entityType: "agent",
      entityId: id,
      details: { keyId: newKeyId },
    });
    return c.json({ id: newKeyId, token: rawToken, label: body.label ?? "API Key" }, 201);
  });

  // DELETE /agents/:id/keys/:keyId
  app.delete("/agents/:id/keys/:keyId", async (c) => {
    const db = c.get("db");
    const id = c.req.param("id")!;
    const keyId = c.req.param("keyId")!;
    const now = new Date().toISOString();
    await db.update(agentApiKeys).set({ revokedAt: now }).where(and(eq(agentApiKeys.id, keyId), eq(agentApiKeys.agentId, id)));
    return c.json({ success: true });
  });

  // POST /agents/:id/wakeup
  app.post("/agents/:id/wakeup", async (c) => {
    const db = c.get("db");
    const id = c.req.param("id")!;
    const agent = await db.select().from(agents).where(eq(agents.id, id)).then((r: any[]) => r[0] ?? null);
    if (!agent) throw notFound("Agent not found");
    assertCompanyAccess(c, agent.companyId);
    const actor = c.get("actor");
    if (actor.type === "agent" && actor.agentId !== id) {
      throw forbidden("Agent can only invoke itself");
    }
    const body = await c.req.json().catch(() => ({}));
    const actorInfo = getActorInfo(c);
    const run = await enqueueHostedHeartbeatRun({
      db,
      env: c.env,
      executionCtx: c.executionCtx,
      agentId: id,
      source: body.source,
      triggerDetail: body.triggerDetail ?? "manual",
      reason: body.reason ?? null,
      payload: asRecord(body.payload) ?? null,
      idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : null,
      requestedByActorType: actorInfo.actorType,
      requestedByActorId: actorInfo.actorId,
      contextSnapshot: {
        triggeredBy: actor.type,
        actorId: actor.type === "agent" ? actor.agentId : actor.type === "board" ? actor.userId : null,
        forceFreshSession: body.forceFreshSession === true,
      },
    });
    if (!run) {
      return c.json({ status: "skipped" }, 202);
    }
    await logActivity(db, {
      companyId: agent.companyId,
      actorType: actorInfo.actorType,
      actorId: actorInfo.actorId,
      agentId: actorInfo.agentId,
      runId: actorInfo.runId,
      action: "heartbeat.invoked",
      entityType: "heartbeat_run",
      entityId: run.id,
      details: { agentId: id },
    });
    return c.json(run, 202);
  });

  // POST /agents/:id/heartbeat/invoke
  app.post("/agents/:id/heartbeat/invoke", async (c) => {
    const db = c.get("db");
    const id = c.req.param("id")!;
    const agent = await db.select().from(agents).where(eq(agents.id, id)).then((r: any[]) => r[0] ?? null);
    if (!agent) throw notFound("Agent not found");
    assertCompanyAccess(c, agent.companyId);
    const actor = c.get("actor");
    if (actor.type === "agent" && actor.agentId !== id) {
      throw forbidden("Agent can only invoke itself");
    }

    const actorInfo = getActorInfo(c);
    const run = await enqueueHostedHeartbeatRun({
      db,
      env: c.env,
      executionCtx: c.executionCtx,
      agentId: id,
      source: "on_demand",
      triggerDetail: "manual",
      reason: "manual",
      requestedByActorType: actorInfo.actorType,
      requestedByActorId: actorInfo.actorId,
      contextSnapshot: {
        triggeredBy: actor.type,
        actorId: actor.type === "agent" ? actor.agentId : actor.type === "board" ? actor.userId : null,
      },
    });
    if (!run) {
      return c.json({ status: "skipped" }, 202);
    }

    await logActivity(db, {
      companyId: agent.companyId,
      actorType: actorInfo.actorType,
      actorId: actorInfo.actorId,
      agentId: actorInfo.agentId,
      runId: actorInfo.runId,
      action: "heartbeat.invoked",
      entityType: "heartbeat_run",
      entityId: run.id,
      details: { agentId: id },
    });

    return c.json(run, 202);
  });

  // POST /agents/:id/claude-login — STUBBED (requires Node.js)
  app.post("/agents/:id/claude-login", async (c) => {
    return c.json({ error: "Claude login not available in Workers runtime" }, 501);
  });

  // GET /companies/:companyId/heartbeat-runs
  app.get("/companies/:companyId/heartbeat-runs", async (c) => {
    const db = c.get("db");
    const companyId = c.req.param("companyId")!;
    assertCompanyAccess(c, companyId);
    const rows = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, companyId)).orderBy(desc(heartbeatRuns.startedAt));
    return c.json(rows);
  });

  // GET /companies/:companyId/live-runs
  app.get("/companies/:companyId/live-runs", async (c) => {
    const db = c.get("db");
    const companyId = c.req.param("companyId")!;
    assertCompanyAccess(c, companyId);
    const rows = await db
      .select({
        id: heartbeatRuns.id,
        status: heartbeatRuns.status,
        invocationSource: heartbeatRuns.invocationSource,
        triggerDetail: heartbeatRuns.triggerDetail,
        startedAt: heartbeatRuns.startedAt,
        finishedAt: heartbeatRuns.finishedAt,
        createdAt: heartbeatRuns.createdAt,
        agentId: heartbeatRuns.agentId,
        agentName: agents.name,
        adapterType: agents.adapterType,
        issueId: sql<string | null>`${heartbeatRuns.contextSnapshot} ->> 'issueId'`.as("issueId"),
      })
      .from(heartbeatRuns)
      .innerJoin(agents, eq(heartbeatRuns.agentId, agents.id))
      .where(and(eq(heartbeatRuns.companyId, companyId), inArray(heartbeatRuns.status, ["queued", "running"])))
      .orderBy(desc(heartbeatRuns.createdAt));
    return c.json(rows);
  });

  // GET /heartbeat-runs/:runId
  app.get("/heartbeat-runs/:runId", async (c) => {
    const db = c.get("db");
    const runId = c.req.param("runId")!;
    const run = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)).then((r: any[]) => r[0] ?? null);
    if (!run) throw notFound("Run not found");
    assertCompanyAccess(c, run.companyId);
    return c.json(run);
  });

  // POST /heartbeat-runs/:runId/cancel
  app.post("/heartbeat-runs/:runId/cancel", async (c) => {
    const db = c.get("db");
    const runId = c.req.param("runId")!;
    const run = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)).then((r: any[]) => r[0] ?? null);
    if (!run) throw notFound("Run not found");
    assertCompanyAccess(c, run.companyId);
    const now = new Date().toISOString();
    await db.update(heartbeatRuns).set({ status: "cancelled", finishedAt: now }).where(eq(heartbeatRuns.id, runId));
    return c.json({ success: true });
  });

  // GET /heartbeat-runs/:runId/events
  app.get("/heartbeat-runs/:runId/events", async (c) => {
    const db = c.get("db");
    const runId = c.req.param("runId")!;
    const run = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)).then((r: any[]) => r[0] ?? null);
    if (!run) throw notFound("Run not found");
    assertCompanyAccess(c, run.companyId);
    const afterSeq = Number(c.req.query("afterSeq") ?? 0);
    const limit = Number(c.req.query("limit") ?? 200);
    const events = await db
      .select()
      .from(heartbeatRunEvents)
      .where(
        and(
          eq(heartbeatRunEvents.runId, runId),
          sql`${heartbeatRunEvents.seq} > ${Number.isFinite(afterSeq) ? afterSeq : 0}`,
        ),
      )
      .orderBy(heartbeatRunEvents.seq)
      .limit(Number.isFinite(limit) ? Math.max(1, Math.min(limit, 200)) : 200);
    return c.json(events.map((e) => ({ ...e, payload: redactPayload(e.payload) })));
  });

  // GET /heartbeat-runs/:runId/log
  app.get("/heartbeat-runs/:runId/log", async (c) => {
    const db = c.get("db");
    const runId = c.req.param("runId")!;
    const run = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)).then((r: any[]) => r[0] ?? null);
    if (!run) throw notFound("Run not found");
    assertCompanyAccess(c, run.companyId);
    const offset = Number(c.req.query("offset") ?? 0);
    const limitBytes = Number(c.req.query("limitBytes") ?? 256000);
    return c.json(
      await readInlineHeartbeatRunLog(
        db,
        runId,
        Number.isFinite(offset) ? offset : 0,
        Number.isFinite(limitBytes) ? limitBytes : 256000,
      ),
    );
  });

  // GET /heartbeat-runs/:runId/workspace-operations
  app.get("/heartbeat-runs/:runId/workspace-operations", async (c) => {
    const db = c.get("db");
    const runId = c.req.param("runId")!;
    const run = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)).then((r: any[]) => r[0] ?? null);
    if (!run) throw notFound("Run not found");
    assertCompanyAccess(c, run.companyId);
    const ops = await db
      .select()
      .from(workspaceOperations)
      .where(eq(workspaceOperations.heartbeatRunId, runId))
      .orderBy(desc(workspaceOperations.createdAt));
    return c.json(ops);
  });

  // GET /workspace-operations/:operationId/log
  app.get("/workspace-operations/:operationId/log", async (c) => {
    const db = c.get("db");
    const operationId = c.req.param("operationId")!;
    const op = await db
      .select()
      .from(workspaceOperations)
      .where(eq(workspaceOperations.id, operationId))
      .then((r: any[]) => r[0] ?? null);
    if (!op) throw notFound("Operation not found");
    return c.json(op);
  });

  // GET /issues/:issueId/live-runs
  app.get("/issues/:issueId/live-runs", async (c) => {
    const db = c.get("db");
    const rawIssueId = c.req.param("issueId")!;
    const issue = await resolveIssueByRef(db, rawIssueId);
    if (!issue) throw notFound("Issue not found");
    assertCompanyAccess(c, issue.companyId);
    const rows = await db
      .select({
        id: heartbeatRuns.id,
        status: heartbeatRuns.status,
        invocationSource: heartbeatRuns.invocationSource,
        triggerDetail: heartbeatRuns.triggerDetail,
        startedAt: heartbeatRuns.startedAt,
        finishedAt: heartbeatRuns.finishedAt,
        createdAt: heartbeatRuns.createdAt,
        agentId: heartbeatRuns.agentId,
        agentName: agents.name,
        adapterType: agents.adapterType,
      })
      .from(heartbeatRuns)
      .innerJoin(agents, eq(heartbeatRuns.agentId, agents.id))
      .where(
        and(
          eq(heartbeatRuns.companyId, issue.companyId),
          inArray(heartbeatRuns.status, ["queued", "running"]),
          sql`${heartbeatRuns.contextSnapshot} ->> 'issueId' = ${issue.id}`,
        ),
      )
      .orderBy(desc(heartbeatRuns.createdAt));
    return c.json(rows);
  });

  // GET /issues/:issueId/active-run
  app.get("/issues/:issueId/active-run", async (c) => {
    const db = c.get("db");
    const rawIssueId = c.req.param("issueId")!;
    const issue = await resolveIssueByRef(db, rawIssueId);
    if (!issue) throw notFound("Issue not found");
    assertCompanyAccess(c, issue.companyId);
    let run = issue.executionRunId
      ? await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, issue.executionRunId)).then((r: any[]) => r[0] ?? null)
      : null;
    if (run && run.status !== "queued" && run.status !== "running") {
      run = null;
    }
    if (!run) {
      run = await db
        .select()
        .from(heartbeatRuns)
        .where(
          and(
            eq(heartbeatRuns.companyId, issue.companyId),
            inArray(heartbeatRuns.status, ["queued", "running"]),
            sql`${heartbeatRuns.contextSnapshot} ->> 'issueId' = ${issue.id}`,
          ),
        )
        .orderBy(
          sql`case when ${heartbeatRuns.status} = 'running' then 0 else 1 end`,
          desc(heartbeatRuns.createdAt),
        )
        .limit(1)
        .then((r: any[]) => r[0] ?? null);
    }
    if (!run) return c.json(null);
    const agent = await db
      .select({
        name: agents.name,
        adapterType: agents.adapterType,
      })
      .from(agents)
      .where(eq(agents.id, run.agentId))
      .limit(1)
      .then((r: any[]) => r[0] ?? null);
    if (!agent) return c.json(null);
    return c.json({
      ...run,
      agentName: agent.name,
      adapterType: agent.adapterType,
    });
  });

  return app;
}
