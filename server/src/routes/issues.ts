import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import multer from "multer";
import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { assets, issueAttachments, issueComments, issueLabels, labels } from "@paperclipai/db";
import {
  addIssueCommentSchema,
  companySearchQuerySchema,
  createIssueLabelSchema,
  createIssueSchema,
  upsertIssueDocumentSchema,
  updateIssueSchema,
} from "@paperclipai/shared";
import type { CompanySearchQuery } from "@paperclipai/shared";
import type { StorageService } from "../storage/types.js";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import {
  accessService,
  companySearchService,
  documentService,
  getStorageService,
  heartbeatService,
  issueApprovalService,
  issueService,
  issueThreadInteractionService,
  logActivity,
  workProductService,
} from "../services/index.js";
import { createCompanySearchRateLimiter, type CompanySearchRateLimiter } from "../services/company-search-rate-limit.js";
import { environmentService } from "../services/environments.js";
import { assertEnvironmentSelectionForCompany } from "./environment-selection.js";

type IssueRouteDeps = {
  searchService?: { search(companyId: string, query: CompanySearchQuery): Promise<unknown> };
  searchRateLimiter?: CompanySearchRateLimiter;
};

const upload = multer({ storage: multer.memoryStorage() });

function isActiveCheckout(issue: { status?: string; assigneeAgentId?: string | null }) {
  return issue.status === "in_progress" && Boolean(issue.assigneeAgentId);
}

async function hasActiveCheckoutGrant(db: Db, req: Request, companyId: string, agentId: string) {
  const access = accessService(db);
  return access.hasPermission(companyId, "agent", agentId, "tasks:manage_active_checkouts" as never).catch(() => false);
}

export function issueRoutes(db: Db, storageService?: StorageService, deps: IssueRouteDeps = {}): Router {
  const router = Router();
  const issues = issueService(db);
  const docs = documentService(db);
  const approvals = issueApprovalService(db);
  const workProducts = workProductService(db);
  const heartbeats = heartbeatService(db);
  const environmentsSvc = environmentService(db);
  let interactions: ReturnType<typeof issueThreadInteractionService> | undefined;
  let search = deps.searchService;
  let searchRateLimiter = deps.searchRateLimiter;
  const storage = storageService ?? getStorageService();

  function getSearchService() {
    search ??= companySearchService(db);
    return search;
  }

  function getSearchRateLimiter() {
    searchRateLimiter ??= createCompanySearchRateLimiter();
    return searchRateLimiter;
  }

  function getInteractionService() {
    interactions ??= issueThreadInteractionService(db);
    return interactions;
  }

  async function resolveIssue(rawId: string) {
    return (await issues.getById(rawId)) ?? issues.getByIdentifier(rawId.toUpperCase());
  }

  async function loadIssueOr404(rawId: string, res: Response) {
    const issue = await resolveIssue(rawId);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return null;
    }
    return issue;
  }

  async function assertCanMutateIssue(req: Request, res: Response, rawId: string) {
    const issue = await loadIssueOr404(rawId, res);
    if (!issue) return null;
    assertCompanyAccess(req, issue.companyId);
    if (req.actor.type !== "agent") return issue;
    const agentId = req.actor.agentId;
    if (!agentId || req.actor.companyId !== issue.companyId) {
      res.status(403).json({ error: "Agent cannot access this issue" });
      return null;
    }
    if (issue.assigneeAgentId && issue.assigneeAgentId !== agentId) {
      if (isActiveCheckout(issue)) {
        const canManage = await hasActiveCheckoutGrant(db, req, issue.companyId, agentId);
        if (!canManage) {
          res.status(409).json({ error: "Issue is checked out by another agent" });
          return null;
        }
        return issue;
      }
      res.status(403).json({ error: "Agent cannot mutate another agent's issue" });
      return null;
    }
    if (isActiveCheckout(issue) && issue.assigneeAgentId === agentId) {
      await issues.assertCheckoutOwner?.(issue.id, agentId, req.actor.runId ?? null);
    }
    return issue;
  }

  async function wakeAssignedAgent(companyId: string, issue: { id: string; assigneeAgentId?: string | null }, mutation: string) {
    if (!issue.assigneeAgentId) return false;
    await heartbeats.wakeup(issue.assigneeAgentId, {
      source: "assignment",
      reason: "issue_assigned",
      payload: { companyId, issueId: issue.id, mutation },
    });
    return true;
  }

  function normalizeAssignedCreateBody(body: Record<string, unknown>) {
    const hasAssignee = typeof body.assigneeAgentId === "string" || typeof body.assigneeUserId === "string";
    const statusDefaulted = hasAssignee && body.status === undefined;
    return {
      body: statusDefaulted ? { ...body, status: "todo" } : body,
      statusDefaulted,
      statusDefaultReason: statusDefaulted ? "assigned_omitted_status" : "explicit",
    };
  }

  function readIssueEnvironmentId(settings: unknown): string | null | undefined {
    if (!settings || typeof settings !== "object" || !("environmentId" in settings)) {
      return undefined;
    }
    const environmentId = (settings as { environmentId?: unknown }).environmentId;
    return typeof environmentId === "string" || environmentId === null ? environmentId : undefined;
  }

  async function assertIssueEnvironmentSelection(companyId: string, settings: unknown) {
    await assertEnvironmentSelectionForCompany(
      environmentsSvc,
      companyId,
      readIssueEnvironmentId(settings),
      { allowedDrivers: ["local", "ssh", "sandbox"] },
    );
  }

  function readObjectBody(req: Request) {
    return req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
  }

  function getThreadActor(req: Request) {
    if (req.actor.type === "agent") {
      return { agentId: req.actor.agentId ?? null, userId: null };
    }
    return { agentId: null, userId: req.actor.userId ?? "board" };
  }

  function shouldWakeForInteraction(interaction: { status?: string; continuationPolicy?: string }) {
    return interaction.continuationPolicy === "wake_assignee"
      || (interaction.continuationPolicy === "wake_assignee_on_accept" && interaction.status === "accepted");
  }

  async function wakeInteractionContinuation(
    issue: { id: string; companyId: string; assigneeAgentId?: string | null },
    interaction: {
      id: string;
      kind?: string;
      status?: string;
      continuationPolicy?: string;
      sourceCommentId?: string | null;
      sourceRunId?: string | null;
    },
    continuationIssue?: { assigneeAgentId?: string | null } | null,
  ) {
    if (!shouldWakeForInteraction(interaction)) return false;
    const agentId = continuationIssue?.assigneeAgentId ?? issue.assigneeAgentId ?? null;
    if (!agentId) return false;
    await heartbeats.wakeup(agentId, {
      source: "automation",
      reason: "issue_commented",
      payload: {
        companyId: issue.companyId,
        issueId: issue.id,
        interactionId: interaction.id,
        interactionKind: interaction.kind,
        interactionStatus: interaction.status,
        sourceCommentId: interaction.sourceCommentId ?? null,
        sourceRunId: interaction.sourceRunId ?? null,
      },
    });
    return true;
  }

  async function logThreadInteraction(req: Request, issue: { id: string; companyId: string }, action: string, interaction: { id: string; kind?: string; status?: string }) {
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: issue.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action,
      entityType: "issue",
      entityId: issue.id,
      details: {
        interactionId: interaction.id,
        interactionKind: interaction.kind,
        interactionStatus: interaction.status,
      },
    });
  }

  router.get("/companies/:companyId/search", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const actor = req.actor.type === "agent"
      ? { companyId, actorType: "agent" as const, actorId: req.actor.agentId ?? "unknown" }
      : { companyId, actorType: "board" as const, actorId: req.actor.userId ?? "board" };
    const rateLimit = getSearchRateLimiter().consume(actor);
    res.set("X-RateLimit-Limit", String(rateLimit.limit));
    res.set("X-RateLimit-Remaining", String(rateLimit.remaining));
    if (!rateLimit.allowed) {
      res.set("Retry-After", String(rateLimit.retryAfterSeconds));
      res.status(429).json({
        error: "Search rate limit exceeded",
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      });
      return;
    }
    const query = companySearchQuerySchema.parse(req.query);
    res.json(await getSearchService().search(companyId, query));
  });

  router.get("/companies/:companyId/issues", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const result = await issues.list(companyId, {
      status: req.query.status as string | undefined,
      projectId: req.query.projectId as string | undefined,
      assigneeAgentId: req.query.assigneeAgentId as string | undefined,
      assigneeUserId: req.query.assigneeUserId as string | undefined,
      labelId: req.query.labelId as string | undefined,
      q: req.query.q as string | undefined,
    });
    res.json(result);
  });

  router.post("/companies/:companyId/issues", async (req, res, next) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const normalized = normalizeAssignedCreateBody(req.body as Record<string, unknown>);
      const body = createIssueSchema.parse(normalized.body);
      await assertIssueEnvironmentSelection(companyId, body.executionWorkspaceSettings);
      const actor = getActorInfo(req);
      const issue = await issues.create(companyId, {
        ...body,
        createdByAgentId: actor.agentId,
        createdByUserId: actor.actorType === "user" ? actor.actorId : undefined,
      });
      if (!issue) {
        res.status(500).json({ error: "Issue could not be created" });
        return;
      }
      const assignmentWakeSkipped = issue.status === "backlog" || !issue.assigneeAgentId;
      if (!assignmentWakeSkipped) await wakeAssignedAgent(companyId, issue, "create");
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "issue.created",
        entityType: "issue",
        entityId: issue.id,
        details: {
          status: issue.status,
          statusDefaulted: normalized.statusDefaulted,
          statusDefaultReason: normalized.statusDefaultReason,
          assignmentWakeSkipped,
          ...(assignmentWakeSkipped && issue.assigneeAgentId ? { assignmentWakeSkipReason: "assigned_backlog" } : {}),
        },
      });
      res.status(201).json(issue);
    } catch (error) {
      next(error);
    }
  });

  router.post("/issues/:id/children", async (req, res, next) => {
    try {
      const parent = await assertCanMutateIssue(req, res, req.params.id as string);
      if (!parent) return;
      const normalized = normalizeAssignedCreateBody(req.body as Record<string, unknown>);
      const childCreator = issues.createChild?.bind(issues);
      const result = childCreator
        ? await childCreator(parent.id, normalized.body)
        : { issue: await issues.create(parent.companyId, { ...normalized.body, parentId: parent.id }), parentBlockerAdded: false };
      const issue = result.issue;
      if (!issue) {
        res.status(500).json({ error: "Child issue could not be created" });
        return;
      }
      const assignmentWakeSkipped = issue.status === "backlog" || !issue.assigneeAgentId;
      if (!assignmentWakeSkipped) await wakeAssignedAgent(parent.companyId, issue, "create");
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId: parent.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "issue.child_created",
        entityType: "issue",
        entityId: issue.id,
        details: {
          parentId: parent.id,
          status: issue.status,
          statusDefaulted: normalized.statusDefaulted,
          statusDefaultReason: normalized.statusDefaultReason,
          assignmentWakeSkipped,
          parentBlockerAdded: result.parentBlockerAdded,
        },
      });
      res.status(201).json(issue);
    } catch (error) {
      next(error);
    }
  });

  router.get("/issues/:id", async (req, res) => {
    const issue = await loadIssueOr404(req.params.id as string, res);
    if (!issue) return;
    assertCompanyAccess(req, issue.companyId);
    res.json(issue);
  });

  router.patch("/issues/:id", validate(updateIssueSchema), async (req, res) => {
    const issue = await assertCanMutateIssue(req, res, req.params.id as string);
    if (!issue) return;
    await assertIssueEnvironmentSelection(issue.companyId, req.body.executionWorkspaceSettings);
    const updated = await issues.update(issue.id, req.body);
    if (!updated) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: issue.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "issue.updated",
      entityType: "issue",
      entityId: issue.id,
      details: req.body,
    });
    res.json(updated);
  });

  router.delete("/issues/:id", async (req, res) => {
    const issue = await assertCanMutateIssue(req, res, req.params.id as string);
    if (!issue) return;
    const removed = await issues.remove?.(issue.id);
    res.json(removed ?? issue);
  });

  router.post("/issues/:id/read", async (req, res) => {
    const issue = await loadIssueOr404(req.params.id as string, res);
    if (!issue) return;
    assertCompanyAccess(req, issue.companyId);
    res.json({ id: issue.id, lastReadAt: new Date() });
  });

  router.get("/issues/:id/comments", async (req, res) => {
    const issue = await loadIssueOr404(req.params.id as string, res);
    if (!issue) return;
    assertCompanyAccess(req, issue.companyId);
    const rows = await db.select().from(issueComments).where(eq(issueComments.issueId, issue.id));
    res.json(rows);
  });

  router.post("/issues/:id/comments", validate(addIssueCommentSchema), async (req, res) => {
    const issue = await assertCanMutateIssue(req, res, req.params.id as string);
    if (!issue) return;
    const actor = getActorInfo(req);
    const comment = await issues.addComment(issue.id, req.body.body, {
      agentId: actor.agentId ?? undefined,
      userId: actor.actorType === "user" ? actor.actorId : undefined,
      runId: actor.runId ?? undefined,
    });
    res.status(201).json(comment);
  });

  router.get("/issues/:id/documents", async (req, res) => {
    const issue = await loadIssueOr404(req.params.id as string, res);
    if (!issue) return;
    assertCompanyAccess(req, issue.companyId);
    res.json(await docs.listIssueDocuments(issue.id));
  });

  router.get("/issues/:id/documents/:key", async (req, res) => {
    const issue = await loadIssueOr404(req.params.id as string, res);
    if (!issue) return;
    assertCompanyAccess(req, issue.companyId);
    const document = await docs.getIssueDocumentByKey(issue.id, req.params.key as string);
    if (!document) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    res.json(document);
  });

  router.put("/issues/:id/documents/:key", validate(upsertIssueDocumentSchema), async (req, res) => {
    const issue = await assertCanMutateIssue(req, res, req.params.id as string);
    if (!issue) return;
    const actor = getActorInfo(req);
    const result = await docs.upsertIssueDocument({
      issueId: issue.id,
      key: req.params.key as string,
      ...req.body,
      createdByAgentId: actor.agentId,
      createdByUserId: actor.actorType === "user" ? actor.actorId : null,
      createdByRunId: actor.runId,
    });
    res.status(result.created ? 201 : 200).json(result.document);
  });

  router.get("/issues/:id/documents/:key/revisions", async (req, res) => {
    const issue = await loadIssueOr404(req.params.id as string, res);
    if (!issue) return;
    assertCompanyAccess(req, issue.companyId);
    res.json(await docs.listIssueDocumentRevisions(issue.id, req.params.key as string));
  });

  router.delete("/issues/:id/documents/:key", async (req, res) => {
    const issue = await assertCanMutateIssue(req, res, req.params.id as string);
    if (!issue) return;
    await docs.deleteIssueDocument(issue.id, req.params.key as string);
    res.json({ ok: true });
  });

  router.get("/issues/:id/attachments", async (req, res) => {
    const issue = await loadIssueOr404(req.params.id as string, res);
    if (!issue) return;
    assertCompanyAccess(req, issue.companyId);
    res.json(await issues.listAttachments?.(issue.id) ?? []);
  });

  router.post("/companies/:companyId/issues/:issueId/attachments", upload.single("file"), async (req, res) => {
    const companyId = req.params.companyId as string;
    const issue = await assertCanMutateIssue(req, res, req.params.issueId as string);
    if (!issue) return;
    assertCompanyAccess(req, companyId);
    if (!req.file) {
      res.status(400).json({ error: "Missing file" });
      return;
    }
    const stored = await storage.putFile({
      companyId,
      namespace: `issues/${issue.id}`,
      originalFilename: req.file.originalname,
      contentType: req.file.mimetype || "application/octet-stream",
      body: req.file.buffer,
    });
    const [asset] = await db.insert(assets).values({
      companyId,
      provider: stored.provider,
      objectKey: stored.objectKey,
      contentType: stored.contentType,
      byteSize: stored.byteSize,
      sha256: stored.sha256,
      originalFilename: stored.originalFilename,
    }).returning();
    const [attachment] = await db.insert(issueAttachments).values({
      companyId,
      issueId: issue.id,
      assetId: asset.id,
      issueCommentId: typeof req.body.issueCommentId === "string" ? req.body.issueCommentId : null,
    }).returning();
    res.status(201).json({ ...attachment, ...stored, assetId: asset.id, contentPath: stored.objectKey });
  });

  router.delete("/attachments/:id", async (req, res) => {
    const attachment = await issues.getAttachmentById?.(req.params.id as string);
    if (!attachment) {
      res.status(404).json({ error: "Attachment not found" });
      return;
    }
    const issue = await assertCanMutateIssue(req, res, attachment.issueId);
    if (!issue) return;
    if (attachment.objectKey) await storage.deleteObject(attachment.companyId, attachment.objectKey);
    const removed = await issues.removeAttachment?.(attachment.id);
    res.json(removed ?? attachment);
  });

  router.get("/companies/:companyId/labels", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await db.select().from(labels).where(eq(labels.companyId, companyId)));
  });

  router.post("/companies/:companyId/labels", validate(createIssueLabelSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const [label] = await db.insert(labels).values({ companyId, ...req.body }).returning();
    res.status(201).json(label);
  });

  router.delete("/labels/:id", async (req, res) => {
    const [label] = await db.delete(labels).where(eq(labels.id, req.params.id as string)).returning();
    if (!label) {
      res.status(404).json({ error: "Label not found" });
      return;
    }
    await db.delete(issueLabels).where(and(eq(issueLabels.companyId, label.companyId), eq(issueLabels.labelId, label.id)));
    res.json(label);
  });

  router.get("/issues/:id/approvals", async (req, res) => {
    const issue = await loadIssueOr404(req.params.id as string, res);
    if (!issue) return;
    assertCompanyAccess(req, issue.companyId);
    res.json(await approvals.listApprovalsForIssue(issue.id));
  });

  router.post("/issues/:id/approvals", async (req, res) => {
    const issue = await assertCanMutateIssue(req, res, req.params.id as string);
    if (!issue) return;
    const result = await approvals.link?.(issue.id, req.body.approvalId) ?? [];
    res.status(201).json(result);
  });

  router.delete("/issues/:id/approvals/:approvalId", async (req, res) => {
    const issue = await assertCanMutateIssue(req, res, req.params.id as string);
    if (!issue) return;
    await approvals.unlink(issue.id, req.params.approvalId as string);
    res.json({ ok: true });
  });

  router.get("/issues/:id/work-products", async (req, res) => {
    const issue = await loadIssueOr404(req.params.id as string, res);
    if (!issue) return;
    assertCompanyAccess(req, issue.companyId);
    res.json(await workProducts.listForIssue(issue.id));
  });

  router.post("/issues/:id/work-products", async (req, res) => {
    const issue = await assertCanMutateIssue(req, res, req.params.id as string);
    if (!issue) return;
    const created = await workProducts.createForIssue?.(issue.id, issue.companyId, req.body);
    res.status(201).json(created);
  });

  router.patch("/work-products/:id", async (req, res) => {
    const product = await workProducts.getById(req.params.id as string);
    if (!product) {
      res.status(404).json({ error: "Work product not found" });
      return;
    }
    const issue = await assertCanMutateIssue(req, res, product.issueId);
    if (!issue) return;
    res.json(await workProducts.update(product.id, req.body));
  });

  router.delete("/work-products/:id", async (req, res) => {
    const product = await workProducts.getById(req.params.id as string);
    if (!product) {
      res.status(404).json({ error: "Work product not found" });
      return;
    }
    const issue = await assertCanMutateIssue(req, res, product.issueId);
    if (!issue) return;
    res.json(await workProducts.remove?.(product.id) ?? product);
  });

  router.get("/issues/:id/interactions", async (req, res) => {
    const issue = await loadIssueOr404(req.params.id as string, res);
    if (!issue) return;
    assertCompanyAccess(req, issue.companyId);
    res.json(await getInteractionService().listForIssue(issue));
  });

  router.post("/issues/:id/interactions", async (req, res) => {
    const issue = await loadIssueOr404(req.params.id as string, res);
    if (!issue) return;
    assertCompanyAccess(req, issue.companyId);
    const body = readObjectBody(req);
    const actor = getThreadActor(req);
    const interaction = await getInteractionService().create(issue, {
      kind: String(body.kind ?? "suggest_tasks"),
      idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : null,
      sourceRunId: req.actor.type === "agent" ? req.actor.runId ?? null : typeof body.sourceRunId === "string" ? body.sourceRunId : null,
      title: typeof body.title === "string" ? body.title : null,
      summary: typeof body.summary === "string" ? body.summary : null,
      continuationPolicy: typeof body.continuationPolicy === "string" ? body.continuationPolicy : "wake_assignee",
      payload: body.payload && typeof body.payload === "object" ? body.payload as Record<string, unknown> : {},
    }, actor);
    await logThreadInteraction(req, issue, "issue.thread_interaction_created", interaction);
    res.status(201).json(interaction);
  });

  router.post("/issues/:id/interactions/:interactionId/accept", async (req, res) => {
    const issue = await loadIssueOr404(req.params.id as string, res);
    if (!issue) return;
    assertCompanyAccess(req, issue.companyId);
    const result = await getInteractionService().acceptInteraction(
      issue,
      req.params.interactionId as string,
      readObjectBody(req) as { selectedClientKeys?: string[] },
      getThreadActor(req),
    );
    for (const createdIssue of result.createdIssues ?? []) {
      if (!createdIssue.assigneeAgentId) continue;
      await heartbeats.wakeup(createdIssue.assigneeAgentId, {
        source: "assignment",
        reason: "issue_assigned",
        payload: {
          companyId: issue.companyId,
          issueId: createdIssue.id,
          mutation: "interaction_accept",
          interactionId: result.interaction.id,
        },
      });
    }
    const continuationIssue = "continuationIssue" in result
      ? result.continuationIssue as { assigneeAgentId?: string | null; assigneeUserId?: string | null; status?: string | null } | null
      : null;
    await wakeInteractionContinuation(issue, result.interaction, continuationIssue);
    if (continuationIssue && (continuationIssue.assigneeAgentId !== issue.assigneeAgentId || continuationIssue.assigneeUserId !== issue.assigneeUserId)) {
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId: issue.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "issue.updated",
        entityType: "issue",
        entityId: issue.id,
        details: {
          source: "request_confirmation_accept",
          assigneeAgentId: continuationIssue.assigneeAgentId ?? null,
          assigneeUserId: continuationIssue.assigneeUserId ?? null,
          _previous: {
            assigneeAgentId: issue.assigneeAgentId ?? null,
            assigneeUserId: issue.assigneeUserId ?? null,
          },
        },
      });
    }
    await logThreadInteraction(req, issue, "issue.thread_interaction_accepted", result.interaction);
    res.json(result.interaction);
  });

  router.post("/issues/:id/interactions/:interactionId/reject", async (req, res) => {
    const issue = await loadIssueOr404(req.params.id as string, res);
    if (!issue) return;
    assertCompanyAccess(req, issue.companyId);
    const interaction = await getInteractionService().rejectInteraction(
      issue,
      req.params.interactionId as string,
      readObjectBody(req),
      getThreadActor(req),
    );
    await wakeInteractionContinuation(issue, interaction);
    await logThreadInteraction(req, issue, "issue.thread_interaction_rejected", interaction);
    res.json(interaction);
  });

  router.post("/issues/:id/interactions/:interactionId/respond", async (req, res) => {
    const issue = await loadIssueOr404(req.params.id as string, res);
    if (!issue) return;
    assertCompanyAccess(req, issue.companyId);
    const body = readObjectBody(req);
    const interaction = await getInteractionService().answerQuestions(
      issue,
      req.params.interactionId as string,
      {
        answers: Array.isArray(body.answers) ? body.answers as Array<{ questionId: string; optionIds: string[] }> : [],
        summaryMarkdown: typeof body.summaryMarkdown === "string" ? body.summaryMarkdown : null,
      },
      getThreadActor(req),
    );
    await wakeInteractionContinuation(issue, interaction);
    await logThreadInteraction(req, issue, "issue.thread_interaction_answered", interaction);
    res.json(interaction);
  });

  router.post("/issues/:id/interactions/:interactionId/cancel", async (req, res) => {
    const issue = await loadIssueOr404(req.params.id as string, res);
    if (!issue) return;
    assertCompanyAccess(req, issue.companyId);
    const interaction = await getInteractionService().cancelQuestions(
      issue,
      req.params.interactionId as string,
      readObjectBody(req),
      getThreadActor(req),
    );
    await wakeInteractionContinuation(issue, interaction);
    await logThreadInteraction(req, issue, "issue.thread_interaction_cancelled", interaction);
    res.json(interaction);
  });

  router.post("/issues/:id/checkout", async (req, res) => {
    const issue = await loadIssueOr404(req.params.id as string, res);
    if (!issue) return;
    await issues.checkout(issue.id, req.body.agentId, req.body.expectedStatuses ?? [], crypto.randomUUID());
    res.json(await issues.getById(issue.id));
  });

  router.post("/issues/:id/release", async (req, res) => {
    const issue = await assertCanMutateIssue(req, res, req.params.id as string);
    if (!issue) return;
    res.json(await issues.update(issue.id, { checkoutRunId: null, executionRunId: null, executionLockedAt: null }));
  });

  router.post("/issues/:id/admin/force-release", async (req, res) => {
    const issue = await loadIssueOr404(req.params.id as string, res);
    if (!issue) return;
    assertCompanyAccess(req, issue.companyId);
    const clearAssignee = req.query.clearAssignee === "true";
    res.json(await issues.update(issue.id, {
      checkoutRunId: null,
      executionRunId: null,
      executionLockedAt: null,
      ...(clearAssignee ? { assigneeAgentId: null } : {}),
    }));
  });

  return router;
}
