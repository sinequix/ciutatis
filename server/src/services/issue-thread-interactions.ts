import type { Db } from "@paperclipai/db";
import { issueThreadInteractions, issues } from "@paperclipai/db";
import { and, eq } from "drizzle-orm";
import { issueService } from "./issues.js";

type ThreadActor = { agentId?: string | null; userId?: string | null };
type ThreadInteraction = {
  id: string;
  companyId: string;
  issueId: string;
  kind: string;
  status: string;
  continuationPolicy: string;
  idempotencyKey: string | null;
  sourceCommentId: string | null;
  sourceRunId: string | null;
  title: string | null;
  summary: string | null;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  resolvedByAgentId: string | null;
  resolvedByUserId: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type IssueRef = { id: string; companyId: string };

export interface IssueThreadInteractionService {
  recordInteraction(): Promise<void>;
  getInteractions(): Promise<unknown[]>;
  listForIssue(_issue: IssueRef): Promise<ThreadInteraction[]>;
  create(
    _issue: IssueRef,
    _params: {
      kind: string;
      idempotencyKey?: string | null;
      sourceRunId?: string | null;
      title?: string | null;
      summary?: string | null;
      continuationPolicy?: string | null;
      payload: Record<string, unknown>;
    },
    _actor: ThreadActor
  ): Promise<ThreadInteraction>;
  acceptInteraction(
    _issue: IssueRef,
    _interactionId: string,
    _params: { selectedClientKeys?: string[] },
    _actor: ThreadActor
  ): Promise<{ interaction: ThreadInteraction; createdIssues: Array<{ id: string; assigneeAgentId?: string | null }> }>;
  rejectInteraction(
    _issue: IssueRef,
    _interactionId: string,
    _params: { reason?: string | null },
    _actor: ThreadActor
  ): Promise<ThreadInteraction>;
  answerQuestions(
    _issue: IssueRef,
    _interactionId: string,
    _answers: {
      answers: Array<{ questionId: string; optionIds: string[] }>;
      summaryMarkdown?: string | null;
    },
    _actor: ThreadActor
  ): Promise<ThreadInteraction>;
  cancelQuestions(
    _issue: IssueRef,
    _interactionId: string,
    _params: { reason?: string | null; summaryMarkdown?: string | null },
    _actor: ThreadActor
  ): Promise<ThreadInteraction>;
}

export function issueThreadInteractionService(_db: Db): IssueThreadInteractionService {
  const db = _db as Db & {
    transaction?: <T>(callback: (tx: Db) => Promise<T>) => Promise<T>;
  };

  function nullableString(value: unknown) {
    return typeof value === "string" ? value : null;
  }

  function normalizeDate(value: unknown) {
    return value instanceof Date ? value : new Date();
  }

  function normalizeRow(row: Record<string, unknown>): ThreadInteraction {
    return {
      id: String(row.id),
      companyId: String(row.companyId),
      issueId: String(row.issueId),
      kind: String(row.kind ?? "unknown"),
      status: String(row.status ?? "pending"),
      continuationPolicy: String(row.continuationPolicy ?? "wake_assignee"),
      idempotencyKey: nullableString(row.idempotencyKey),
      sourceCommentId: nullableString(row.sourceCommentId),
      sourceRunId: nullableString(row.sourceRunId),
      title: nullableString(row.title),
      summary: nullableString(row.summary),
      createdByAgentId: nullableString(row.createdByAgentId),
      createdByUserId: nullableString(row.createdByUserId),
      resolvedByAgentId: nullableString(row.resolvedByAgentId),
      resolvedByUserId: nullableString(row.resolvedByUserId),
      payload: (row.payload && typeof row.payload === "object" ? row.payload : {}) as Record<string, unknown>,
      result: (row.result && typeof row.result === "object" ? row.result : null) as Record<string, unknown> | null,
      resolvedAt: row.resolvedAt instanceof Date ? row.resolvedAt : null,
      createdAt: normalizeDate(row.createdAt),
      updatedAt: normalizeDate(row.updatedAt),
    };
  }

  async function updateResolved(
    issue: IssueRef,
    interactionId: string,
    values: Record<string, unknown>,
    actor: ThreadActor,
  ) {
    const now = new Date();
    const run = async (tx: Db) => {
      const updated = await tx
        .update(issueThreadInteractions)
        .set({
          ...values,
          resolvedAt: now,
          resolvedByAgentId: actor.agentId ?? null,
          resolvedByUserId: actor.userId ?? null,
          updatedAt: now,
        })
        .where(and(
          eq(issueThreadInteractions.companyId, issue.companyId),
          eq(issueThreadInteractions.issueId, issue.id),
          eq(issueThreadInteractions.id, interactionId),
        ))
        .returning();
      await tx
        .update(issues)
        .set({ updatedAt: now })
        .where(eq(issues.id, issue.id));
      return updated[0] as Record<string, unknown> | undefined;
    };
    const row = db.transaction ? await db.transaction(run) : await run(db);
    return row ? normalizeRow(row) : null;
  }

  return {
    async recordInteraction() {
      // No-op - feature removed
    },
    async getInteractions() {
      return [];
    },
    async listForIssue(issue) {
      const rows = await db
        .select()
        .from(issueThreadInteractions)
        .where(and(
          eq(issueThreadInteractions.companyId, issue.companyId),
          eq(issueThreadInteractions.issueId, issue.id),
        ));
      return rows.map((row) => normalizeRow(row as Record<string, unknown>));
    },
    async create(issue, params, actor) {
      if (params.idempotencyKey) {
        const existing = await db
          .select()
          .from(issueThreadInteractions)
          .where(and(
            eq(issueThreadInteractions.companyId, issue.companyId),
            eq(issueThreadInteractions.issueId, issue.id),
            eq(issueThreadInteractions.idempotencyKey, params.idempotencyKey),
          ));
        if (existing[0]) return normalizeRow(existing[0] as Record<string, unknown>);
      }

      const now = new Date();
      const inserted = await db
        .insert(issueThreadInteractions)
        .values({
          companyId: issue.companyId,
          issueId: issue.id,
          kind: params.kind,
          status: "pending",
          continuationPolicy: params.continuationPolicy ?? "wake_assignee",
          idempotencyKey: params.idempotencyKey ?? null,
          sourceRunId: params.sourceRunId ?? null,
          title: params.title ?? null,
          summary: params.summary ?? null,
          createdByAgentId: actor.agentId ?? null,
          createdByUserId: actor.userId ?? null,
          payload: params.payload,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const row = inserted[0] as Record<string, unknown> | undefined;
      if (row) return normalizeRow(row);
      return {
        id: "stub-id",
        companyId: issue.companyId,
        issueId: issue.id,
        kind: params.kind,
        status: "pending",
        continuationPolicy: params.continuationPolicy ?? "wake_assignee",
        sourceCommentId: null,
        sourceRunId: params.sourceRunId ?? null,
        title: params.title ?? null,
        summary: params.summary ?? null,
        createdByAgentId: actor.agentId ?? null,
        createdByUserId: actor.userId ?? null,
        resolvedByAgentId: null,
        resolvedByUserId: null,
        payload: params.payload,
        result: null,
        idempotencyKey: params.idempotencyKey ?? null,
        resolvedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },
    async acceptInteraction(issue, interactionId, params, actor) {
      const [existing] = await db
        .select()
        .from(issueThreadInteractions)
        .where(and(
          eq(issueThreadInteractions.companyId, issue.companyId),
          eq(issueThreadInteractions.issueId, issue.id),
          eq(issueThreadInteractions.id, interactionId),
        ));
      const interaction = existing ? normalizeRow(existing as Record<string, unknown>) : null;
      const payload = interaction?.payload ?? {};
      const tasks = Array.isArray(payload.tasks) ? payload.tasks as Array<Record<string, unknown>> : [];
      const selected = Array.isArray(params.selectedClientKeys) && params.selectedClientKeys.length > 0
        ? new Set(params.selectedClientKeys)
        : new Set(tasks.map((task) => String(task.clientKey)));
      const createdIssues: Array<{ id: string; assigneeAgentId?: string | null }> = [];
      const createdTasks: Array<Record<string, unknown>> = [];
      const skippedClientKeys: string[] = [];

      if (interaction?.kind === "suggest_tasks") {
        const issueSvc = issueService(db);
        for (const task of tasks) {
          const clientKey = String(task.clientKey ?? "");
          if (!clientKey || !selected.has(clientKey)) {
            if (clientKey) skippedClientKeys.push(clientKey);
            continue;
          }
          const created = await issueSvc.createChild?.(issue.id, {
            title: String(task.title ?? "Suggested task"),
            description: typeof task.description === "string" ? task.description : null,
            priority: typeof task.priority === "string" ? task.priority : undefined,
            assigneeAgentId: typeof task.assigneeAgentId === "string" ? task.assigneeAgentId : null,
            assigneeUserId: typeof task.assigneeUserId === "string" ? task.assigneeUserId : null,
            status: typeof task.assigneeAgentId === "string" || typeof task.assigneeUserId === "string" ? "todo" : "backlog",
          });
          if (created?.issue) {
            createdIssues.push(created.issue);
            createdTasks.push({
              clientKey,
              issueId: created.issue.id,
              title: created.issue.title,
              identifier: created.issue.identifier,
              parentIssueId: issue.id,
            });
          }
        }
      }

      const result = interaction?.kind === "suggest_tasks"
        ? { version: 1, selectedClientKeys: Array.from(selected), createdTasks, skippedClientKeys }
        : { version: 1, outcome: "accepted" };
      const updated = await updateResolved(issue, interactionId, { status: "accepted", result }, actor);
      return {
        interaction: updated ?? {
          id: interactionId,
          companyId: issue.companyId,
          issueId: issue.id,
          kind: interaction?.kind ?? "request_confirmation",
          status: "accepted",
          continuationPolicy: interaction?.continuationPolicy ?? "wake_assignee_on_accept",
          idempotencyKey: interaction?.idempotencyKey ?? null,
          sourceCommentId: interaction?.sourceCommentId ?? null,
          sourceRunId: interaction?.sourceRunId ?? null,
          title: interaction?.title ?? null,
          summary: interaction?.summary ?? null,
          createdByAgentId: interaction?.createdByAgentId ?? null,
          createdByUserId: interaction?.createdByUserId ?? null,
          resolvedByAgentId: actor.agentId ?? null,
          resolvedByUserId: actor.userId ?? null,
          payload,
          result,
          resolvedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        createdIssues,
      };
    },
    async rejectInteraction(issue, interactionId, params, actor) {
      const result = { version: 1, outcome: "rejected", rejectionReason: params.reason ?? null, reason: params.reason ?? null };
      const updated = await updateResolved(issue, interactionId, { status: "rejected", result }, actor);
      if (updated) return updated;
      const now = new Date();
      return {
        id: interactionId,
        companyId: issue.companyId,
        issueId: issue.id,
        kind: "request_confirmation",
        status: "rejected",
        continuationPolicy: "wake_assignee_on_accept",
        idempotencyKey: null,
        sourceCommentId: null,
        sourceRunId: null,
        title: null,
        summary: null,
        createdByAgentId: null,
        createdByUserId: null,
        resolvedByAgentId: actor.agentId ?? null,
        resolvedByUserId: actor.userId ?? null,
        payload: {},
        result,
        resolvedAt: now,
        createdAt: now,
        updatedAt: now,
      };
    },
    async answerQuestions(issue, interactionId, answers, actor) {
      const result = {
        version: 1,
        answers: answers.answers.map((answer) => ({
          questionId: answer.questionId,
          optionIds: Array.from(new Set(answer.optionIds)),
        })),
        summaryMarkdown: answers.summaryMarkdown ?? null,
      };
      const updated = await updateResolved(issue, interactionId, { status: "answered", result }, actor);
      if (updated) return { ...updated, result };
      const now = new Date();
      return {
        id: interactionId,
        companyId: issue.companyId,
        issueId: issue.id,
        kind: "ask_user_questions",
        status: "answered",
        continuationPolicy: "wake_assignee",
        idempotencyKey: null,
        sourceCommentId: null,
        sourceRunId: null,
        title: null,
        summary: null,
        createdByAgentId: null,
        createdByUserId: null,
        resolvedByAgentId: actor.agentId ?? null,
        resolvedByUserId: actor.userId ?? null,
        payload: {},
        result,
        resolvedAt: now,
        createdAt: now,
        updatedAt: now,
      };
    },
    async cancelQuestions(issue, interactionId, params, actor) {
      const result = {
        version: 1,
        answers: [],
        cancelled: true,
        cancellationReason: params.reason ?? null,
        summaryMarkdown: params.summaryMarkdown ?? null,
      };
      const updated = await updateResolved(issue, interactionId, { status: "cancelled", result }, actor);
      if (updated) return { ...updated, result };
      const now = new Date();
      return {
        id: interactionId,
        companyId: issue.companyId,
        issueId: issue.id,
        kind: "ask_user_questions",
        status: "cancelled",
        continuationPolicy: "wake_assignee",
        idempotencyKey: null,
        sourceCommentId: null,
        sourceRunId: null,
        title: null,
        summary: null,
        createdByAgentId: null,
        createdByUserId: null,
        resolvedByAgentId: actor.agentId ?? null,
        resolvedByUserId: actor.userId ?? null,
        payload: {},
        result,
        resolvedAt: now,
        createdAt: now,
        updatedAt: now,
      };
    },
  };
}
