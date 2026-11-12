import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { agents as agentsTable } from "@paperclipai/db";
import {
  createCompanySchema,
  updateCompanySchema,
  companyPortabilityExportSchema,
  companyPortabilityImportSchema,
  companyPortabilityPreviewSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import {
  agentService,
  companyPortabilityService,
  companyService,
  logActivity,
  workTimelineService,
} from "../services/index.js";
import { forbidden, notFound } from "../errors.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";

const updateCompanyBrandingSchema = z
  .object({
    brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
    logoAssetId: z.string().uuid().nullable().optional(),
  })
  .strict();

export function companyRoutes(db: Db): Router {
  const router = Router();
  const companiesSvc = companyService(db);
  const agentsSvc = agentService(db);
  const portabilitySvc = companyPortabilityService(db);

  async function requireCompany(companyId: string) {
    const company = await companiesSvc.getById(companyId);
    if (!company) throw notFound("Company not found");
    return company;
  }

  async function assertCanUpdateBranding(req: Request, companyId: string): Promise<void> {
    assertCompanyAccess(req, companyId);
    if (req.actor.type === "board") return;
    if (req.actor.type !== "agent" || !req.actor.agentId) {
      throw forbidden("Board or CEO agent authentication required");
    }
    const agent = await agentsSvc.getById(req.actor.agentId);
    if (!agent || agent.companyId !== companyId || agent.role !== "ceo") {
      throw forbidden("Only CEO agents can update company branding");
    }
  }

  router.get("/", async (req, res) => {
    assertBoard(req);
    const companies = await companiesSvc.list();
    if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) {
      res.json(companies);
      return;
    }
    const allowed = new Set(req.actor.companyIds ?? []);
    res.json(companies.filter((company) => allowed.has(company.id)));
  });

  router.get("/stats", async (req, res) => {
    assertBoard(req);
    const stats = await companiesSvc.stats();
    if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) {
      res.json(stats);
      return;
    }
    const allowed = new Set(req.actor.companyIds ?? []);
    res.json(Object.fromEntries(Object.entries(stats).filter(([companyId]) => allowed.has(companyId))));
  });

  router.post("/", validate(createCompanySchema), async (req, res) => {
    assertBoard(req);
    const company = await companiesSvc.create(req.body);
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: company.id,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "company.created",
      entityType: "company",
      entityId: company.id,
      details: { name: company.name },
    });
    res.status(201).json(company);
  });

  router.post("/import/preview", validate(companyPortabilityPreviewSchema), async (req, res) => {
    assertBoard(req);
    res.json(await portabilitySvc.previewImport(req.body));
  });

  router.post("/import", validate(companyPortabilityImportSchema), async (req, res) => {
    assertBoard(req);
    res.status(201).json(await portabilitySvc.importBundle(req.body, req.actor.userId ?? null));
  });

  router.get("/:companyId", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await requireCompany(companyId));
  });

  router.patch("/:companyId", validate(updateCompanySchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    await requireCompany(companyId);
    const company = await companiesSvc.update(companyId, req.body);
    if (!company) throw notFound("Company not found");
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "company.updated",
      entityType: "company",
      entityId: companyId,
      details: req.body,
    });
    res.json(company);
  });

  router.patch("/:companyId/branding", async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCanUpdateBranding(req, companyId);
    const company = await companiesSvc.update(companyId, req.body);
    if (!company) throw notFound("Company not found");
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "company.branding_updated",
      entityType: "company",
      entityId: companyId,
      details: body,
    });
    res.json(company);
  });

  router.post("/:companyId/archive", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const company = await companiesSvc.archive(companyId);
    if (!company) throw notFound("Company not found");
    res.json(company);
  });

  router.delete("/:companyId", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const removed = await companiesSvc.remove(companyId);
    if (!removed) throw notFound("Company not found");
    res.json({ ok: true });
  });

  router.post("/:companyId/export", validate(companyPortabilityExportSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    res.json(await portabilitySvc.exportBundle(companyId, req.body));
  });

  return router;
}

type CompanyImportResult = {
  company: { id: string; action: unknown };
  agents: unknown[];
  warnings: unknown[];
};

interface ImportJobRecord {
  id: string;
  cloudTenantKey: string;
  status: "running" | "succeeded" | "failed";
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: { message: string };
  result?: {
    companyId: string;
    agentCount: number;
    warningCount: number;
    companyAction: unknown;
  };
}

interface ImportedCompanyActivityContext {
  actorType: "user" | "agent";
  actorId: string;
  agentId: string | null;
  runId: string | null;
  include: unknown;
}

function assertCloudTenantCaller(req: Request) {
  if (req.actor.source !== "cloud_tenant") {
    throw forbidden("Trusted Cloud tenant access required");
  }
}

function cloudTenantRequestKey(req: Request) {
  return [
    req.actor.userId ?? "",
    req.header("x-paperclip-cloud-stack-id")?.trim() ?? "",
    req.header("x-paperclip-cloud-paperclip-company-id")?.trim() ?? "",
  ].join(":");
}

function createImportJob(cloudTenantKey: string): ImportJobRecord {
  const now = new Date().toISOString();
  return {
    id: `tenant-import-${randomUUID()}`,
    cloudTenantKey,
    status: "running",
    createdAt: now,
    updatedAt: now,
  };
}

async function runImportJob(
  job: ImportJobRecord,
  operation: () => Promise<CompanyImportResult>,
) {
  try {
    const result = await operation();
    const now = new Date().toISOString();
    job.status = "succeeded";
    job.updatedAt = now;
    job.completedAt = now;
    job.result = {
      companyId: result.company.id,
      agentCount: result.agents.length,
      warningCount: result.warnings.length,
      companyAction: result.company.action,
    };
  } catch (error) {
    const now = new Date().toISOString();
    job.status = "failed";
    job.updatedAt = now;
    job.completedAt = now;
    job.error = { message: errorMessage(error) };
  }
}

function importedCompanyActivityContext(
  actor: ReturnType<typeof getActorInfo>,
  include: unknown,
): ImportedCompanyActivityContext {
  return {
    actorType: actor.actorType,
    actorId: actor.actorId,
    agentId: actor.agentId,
    runId: actor.runId,
    include,
  };
}

async function logImportedCompanyActivity(
  db: Db,
  activity: ImportedCompanyActivityContext,
  result: CompanyImportResult,
) {
  await logActivity(db, {
    companyId: result.company.id,
    actorType: activity.actorType,
    actorId: activity.actorId,
    action: "company.imported",
    entityType: "company",
    entityId: result.company.id,
    agentId: activity.agentId,
    runId: activity.runId,
    details: {
      include: activity.include,
      agentCount: result.agents.length,
      warningCount: result.warnings.length,
      companyAction: result.company.action,
    },
  });
}

function importJobAcceptedResponse(job: ImportJobRecord) {
  return {
    job: {
      id: job.id,
      status: job.status,
    },
    statusUrl: `/api/companies/import/jobs/${encodeURIComponent(job.id)}`,
    retryAfterMs: 1000,
  };
}

function importJobResponse(job: ImportJobRecord) {
  const isTerminal = job.status === "succeeded" || job.status === "failed";
  const response: Record<string, unknown> = {
    job: {
      id: job.id,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      ...(job.completedAt ? { completedAt: job.completedAt } : {}),
      ...(job.error ? { error: job.error } : {}),
      ...(job.result ? { result: job.result } : {}),
    },
    ...(isTerminal ? {} : { retryAfterMs: 1000 }),
  };
  if (job.error?.message) {
    response.error = job.error.message;
    response.message = job.error.message;
    response.reason = job.error.message;
  }
  return response;
}

function cleanupTerminalImportJobs(importJobs: Map<string, ImportJobRecord>, terminalRetentionMs: number) {
  const now = Date.now();
  for (const [jobId, job] of importJobs) {
    if (job.status === "running" || !job.completedAt) continue;
    if (now - Date.parse(job.completedAt) > terminalRetentionMs) {
      importJobs.delete(jobId);
    }
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message.trim() ? error.message : String(error);
}
