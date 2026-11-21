import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import {
  instanceSettings,
  tenantInstances,
  tenantProvisioningJobs,
} from "@paperclipai/db";
import {
  cloudflareProvisioningSettingsSchema,
  createTenantInstanceSchema,
  deriveTenantRoute,
  issueGraphLivenessAutoRecoveryRequestSchema,
  patchCloudflareProvisioningSettingsSchema,
  patchInstanceSettingsSchema,
  patchInstanceExperimentalSettingsSchema,
  patchInstanceGeneralSettingsSchema,
  patchTenantProvisioningSettingsSchema,
  tenantProvisioningSettingsSchema,
  updateTenantInstanceSchema,
  type CloudflareProvisioningSettings,
  type InstanceAdminOverview,
  type TenantInstance,
  type TenantProvisioningJob,
  type TenantProvisioningJobSummary,
  type TenantProvisioningSettings,
} from "@paperclipai/shared";
import { forbidden } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { heartbeatService, instanceSettingsService, logActivity } from "../services/index.js";
import { environmentService } from "../services/environments.js";
import { assertEnvironmentSelectionForCompany } from "./environment-selection.js";
import { assertBoardOrgAccess, getActorInfo } from "./authz.js";
import { and, desc, eq } from "drizzle-orm";

const DEFAULT_SINGLETON_KEY = "default";

type InstanceSettingsRow = typeof instanceSettings.$inferSelect;
type TenantInstanceRow = typeof tenantInstances.$inferSelect;
type TenantProvisioningJobRow = typeof tenantProvisioningJobs.$inferSelect;

function assertCanManageInstanceSettings(req: Request) {
  if (req.actor.type !== "board") {
    throw forbidden("Board access required");
  }
  if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) {
    return;
  }
  throw forbidden("Instance admin access required");
}

function cloudflareTokenConfigured() {
  return Boolean(
    process.env.CLOUDFLARE_API_TOKEN ||
    process.env.CF_API_TOKEN ||
    process.env.CLOUDFLARE_API_KEY,
  );
}

function normalizeTenantProvisioning(raw: unknown): TenantProvisioningSettings {
  return tenantProvisioningSettingsSchema.parse(raw ?? {});
}

function normalizeCloudflareProvisioning(raw: unknown): CloudflareProvisioningSettings {
  const parsed = cloudflareProvisioningSettingsSchema.parse(raw ?? {});
  return {
    ...parsed,
    apiTokenConfigured: parsed.apiTokenConfigured || cloudflareTokenConfigured(),
  };
}

function normalizePathPrefix(pathPrefix: string) {
  const normalized = pathPrefix.trim().replace(/\/+/g, "/");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function buildTenantUrl(
  tenant: Pick<TenantInstanceRow, "routingMode" | "hostname" | "citySlug" | "pathPrefix">,
  settings: TenantProvisioningSettings,
) {
  if (tenant.routingMode === "custom_domain" && tenant.hostname) {
    return `https://${tenant.hostname}`;
  }
  if (tenant.routingMode === "subdomain") {
    return `https://${tenant.citySlug}.${settings.baseDomain}`;
  }
  return `https://${settings.baseDomain}${normalizePathPrefix(tenant.pathPrefix)}`;
}

function toJobSummary(row: TenantProvisioningJobRow): TenantProvisioningJobSummary {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    trigger: row.trigger,
    step: row.step,
    attempt: row.attempt,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    errorMessage: row.errorMessage,
  };
}

function toJob(row: TenantProvisioningJobRow): TenantProvisioningJob {
  return {
    ...toJobSummary(row),
    tenantId: row.tenantId,
    errorCode: row.errorCode,
    details: row.details,
    updatedAt: row.updatedAt,
  };
}

function toTenant(
  row: TenantInstanceRow,
  latestJob: TenantProvisioningJobRow | null,
  provisioning: TenantProvisioningSettings,
): TenantInstance {
  return {
    id: row.id,
    name: row.name,
    municipalityName: row.municipalityName,
    countryCode: row.countryCode,
    jurisdictionType: row.jurisdictionType,
    postalCode: row.postalCode,
    citySlug: row.citySlug,
    shortCode: row.shortCode,
    parentSubdivisionCode: row.parentSubdivisionCode,
    parentSubdivisionName: row.parentSubdivisionName,
    routingMode: row.routingMode,
    status: row.status,
    pathPrefix: row.pathPrefix,
    dispatcherKey: row.dispatcherKey,
    hostname: row.hostname,
    workerName: row.workerName,
    dispatchScriptName: row.dispatchScriptName,
    tenantD1DatabaseId: row.tenantD1DatabaseId,
    tenantD1DatabaseName: row.tenantD1DatabaseName,
    tenantKvNamespaceId: row.tenantKvNamespaceId,
    tenantKvNamespaceTitle: row.tenantKvNamespaceTitle,
    tenantR2BucketName: row.tenantR2BucketName,
    bootstrapStatus: row.bootstrapStatus,
    lastDeploymentStartedAt: row.lastDeploymentStartedAt,
    lastDeploymentFinishedAt: row.lastDeploymentFinishedAt,
    lastDeploymentError: row.lastDeploymentError,
    notes: row.notes,
    latestJob: latestJob ? toJobSummary(latestJob) : null,
    tenantUrl: buildTenantUrl(row, provisioning),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function instanceSettingsRoutes(db: Db) {
  const router = Router();
  const svc = instanceSettingsService(db);
  const environments = environmentService(db);
  const heartbeat = heartbeatService(db);

  async function getSettingsRow(): Promise<InstanceSettingsRow> {
    await svc.get();
    const row = await db
      .select()
      .from(instanceSettings)
      .where(eq(instanceSettings.singletonKey, DEFAULT_SINGLETON_KEY))
      .then((rows) => rows[0] ?? null);
    if (!row) {
      throw new Error("Failed to initialize instance settings row");
    }
    return row;
  }

  async function getTenantProvisioningSettings() {
    return normalizeTenantProvisioning((await getSettingsRow()).tenantProvisioning);
  }

  async function getCloudflareProvisioningSettings() {
    return normalizeCloudflareProvisioning((await getSettingsRow()).cloudflareProvisioning);
  }

  async function updateTenantProvisioningSettings(patch: Partial<TenantProvisioningSettings>) {
    const row = await getSettingsRow();
    const next = normalizeTenantProvisioning({
      ...normalizeTenantProvisioning(row.tenantProvisioning),
      ...patch,
    });
    const [updated] = await db
      .update(instanceSettings)
      .set({ tenantProvisioning: next as unknown as Record<string, unknown>, updatedAt: new Date() })
      .where(eq(instanceSettings.id, row.id))
      .returning();
    return normalizeTenantProvisioning((updated ?? row).tenantProvisioning);
  }

  async function updateCloudflareProvisioningSettings(patch: Partial<CloudflareProvisioningSettings>) {
    const row = await getSettingsRow();
    const next = normalizeCloudflareProvisioning({
      ...normalizeCloudflareProvisioning(row.cloudflareProvisioning),
      ...patch,
      apiTokenConfigured: cloudflareTokenConfigured(),
    });
    const [updated] = await db
      .update(instanceSettings)
      .set({ cloudflareProvisioning: next as unknown as Record<string, unknown>, updatedAt: new Date() })
      .where(eq(instanceSettings.id, row.id))
      .returning();
    return normalizeCloudflareProvisioning((updated ?? row).cloudflareProvisioning);
  }

  async function latestJobsByTenant() {
    const jobs = await db
      .select()
      .from(tenantProvisioningJobs)
      .orderBy(desc(tenantProvisioningJobs.createdAt));
    const latest = new Map<string, TenantProvisioningJobRow>();
    for (const job of jobs) {
      if (!latest.has(job.tenantId)) latest.set(job.tenantId, job);
    }
    return latest;
  }

  async function listTenantResponses() {
    const [provisioning, latestJobs, rows] = await Promise.all([
      getTenantProvisioningSettings(),
      latestJobsByTenant(),
      db.select().from(tenantInstances).orderBy(desc(tenantInstances.createdAt)),
    ]);
    return rows.map((row) => toTenant(row, latestJobs.get(row.id) ?? null, provisioning));
  }

  async function createProvisioningJob(input: {
    tenantId: string;
    kind: "initial_provision" | "redeploy" | "archive";
    trigger: "tenant_created" | "manual_redeploy" | "manual_archive";
    queued: boolean;
  }) {
    const now = new Date();
    return db
      .insert(tenantProvisioningJobs)
      .values({
        tenantId: input.tenantId,
        kind: input.kind,
        trigger: input.trigger,
        status: input.queued ? "queued" : "succeeded",
        step: input.queued ? "queued" : input.kind === "archive" ? "archive_soft_delete" : "finalize",
        startedAt: input.queued ? null : now,
        finishedAt: input.queued ? null : now,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .then((rows) => rows[0] ?? null);
  }

  async function loadTenantOrThrow(tenantId: string) {
    const row = await db
      .select()
      .from(tenantInstances)
      .where(eq(tenantInstances.id, tenantId))
      .then((rows) => rows[0] ?? null);
    if (!row) {
      const error = new Error("Tenant not found") as Error & { status?: number };
      error.status = 404;
      throw error;
    }
    return row;
  }
  router.get("/instance/settings", async (req, res) => {
    assertBoardOrgAccess(req);
    res.json(await svc.get());
  });
  router.patch(
    "/instance/settings",
    validate(patchInstanceSettingsSchema),
    async (req, res) => {
      assertCanManageInstanceSettings(req);
      if (Object.prototype.hasOwnProperty.call(req.body, "defaultEnvironmentId")) {
        await assertEnvironmentSelectionForCompany(
          environments,
          "instance",
          typeof req.body.defaultEnvironmentId === "string" ? req.body.defaultEnvironmentId : null,
        );
      }
      const updated = await svc.update(req.body);
      const actor = getActorInfo(req);
      const companyIds = await svc.listCompanyIds();
      await Promise.all(
        companyIds.map((companyId) =>
          logActivity(db, {
            companyId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            agentId: actor.agentId,
            runId: actor.runId,
            action: "instance.settings.updated",
            entityType: "instance_settings",
            entityId: updated.id,
            details: {
              defaultEnvironmentId: updated.defaultEnvironmentId,
              changedKeys: Object.keys(req.body).sort(),
            },
          }),
        ),
      );
      res.json(updated);
    },
  );

  router.get("/instance/settings/general", async (req, res) => {
    // General settings (e.g. keyboardShortcuts) are readable by any
    // authenticated org member or instance admin. Only PATCH requires instance-admin.
    assertBoardOrgAccess(req);
    res.json(await svc.getGeneral());
  });

  router.patch(
    "/instance/settings/general",
    (req, _res, next) => {
      try {
        assertCanManageInstanceSettings(req);
        next();
      } catch (error) {
        next(error);
      }
    },
    validate(patchInstanceGeneralSettingsSchema),
    async (req, res) => {
      const updated = await svc.updateGeneral(req.body);
      const actor = getActorInfo(req);
      const companyIds = await svc.listCompanyIds();
      await Promise.all(
        companyIds.map((companyId) =>
          logActivity(db, {
            companyId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            agentId: actor.agentId,
            runId: actor.runId,
            action: "instance.settings.general_updated",
            entityType: "instance_settings",
            entityId: updated.id,
            details: {
              general: updated.general,
              changedKeys: Object.keys(req.body).sort(),
            },
          }),
        ),
      );
      res.json(updated.general);
    },
  );

  router.get("/instance/settings/experimental", async (req, res) => {
    // Experimental settings are readable by any authenticated org member
    // or instance admin. Only PATCH requires instance-admin.
    assertBoardOrgAccess(req);
    // or instance admin. Updating them remains instance-admin only because
    // this payload includes instance-wide operational controls.
    assertBoardOrgAccess(req);
    res.json(await svc.getExperimental());
  });

  router.patch(
    "/instance/settings/experimental",
    (req, _res, next) => {
      try {
        assertCanManageInstanceSettings(req);
        next();
      } catch (error) {
        next(error);
      }
    },
    validate(patchInstanceExperimentalSettingsSchema),
    async (req, res) => {
      const updated = await svc.updateExperimental(req.body);
      const actor = getActorInfo(req);
      const companyIds = await svc.listCompanyIds();
      await Promise.all(
        companyIds.map((companyId) =>
          logActivity(db, {
            companyId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            agentId: actor.agentId,
            runId: actor.runId,
            action: "instance.settings.experimental_updated",
            entityType: "instance_settings",
            entityId: updated.id,
            details: {
              experimental: updated.experimental,
              changedKeys: Object.keys(req.body).sort(),
            },
          }),
        ),
      );
      res.json(updated.experimental);
    },
  );

  router.post(
    "/instance/settings/experimental/issue-graph-liveness-auto-recovery/preview",
    validate(issueGraphLivenessAutoRecoveryRequestSchema),
    async (req, res) => {
      assertCanManageInstanceSettings(req);
      res.json(await heartbeat.buildIssueGraphLivenessAutoRecoveryPreview({
        lookbackHours: req.body.lookbackHours,
      }));
    },
  );

  router.post(
    "/instance/settings/experimental/issue-graph-liveness-auto-recovery/run",
    validate(issueGraphLivenessAutoRecoveryRequestSchema),
    async (req, res) => {
      assertCanManageInstanceSettings(req);
      const actor = getActorInfo(req);
      const result = await heartbeat.reconcileIssueGraphLiveness({
        runId: actor.runId,
        force: true,
        lookbackHours: req.body.lookbackHours,
      });
      const companyIds = await svc.listCompanyIds();
      await Promise.all(
        companyIds.map((companyId) =>
          logActivity(db, {
            companyId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            agentId: actor.agentId,
            runId: actor.runId,
            action: "instance.settings.issue_graph_liveness_auto_recovery_run",
            entityType: "instance_settings",
            entityId: "default",
            details: {
              lookbackHours: result.lookbackHours,
              escalationsCreated: result.escalationsCreated,
              existingEscalations: result.existingEscalations,
              skippedOutsideLookback: result.skippedOutsideLookback,
              escalationIssueIds: result.escalationIssueIds,
            },
          }),
        ),
      );
      res.json(result);
    },
  );

  router.get("/instance/settings/tenant-provisioning", async (req, res) => {
    assertBoardOrgAccess(req);
    res.json(await getTenantProvisioningSettings());
  });

  router.patch(
    "/instance/settings/tenant-provisioning",
    (req, _res, next) => {
      try {
        assertCanManageInstanceSettings(req);
        next();
      } catch (error) {
        next(error);
      }
    },
    validate(patchTenantProvisioningSettingsSchema),
    async (req, res) => {
      res.json(await updateTenantProvisioningSettings(req.body));
    },
  );

  router.get("/instance/settings/cloudflare", async (req, res) => {
    assertBoardOrgAccess(req);
    res.json(await getCloudflareProvisioningSettings());
  });

  router.patch(
    "/instance/settings/cloudflare",
    (req, _res, next) => {
      try {
        assertCanManageInstanceSettings(req);
        next();
      } catch (error) {
        next(error);
      }
    },
    validate(patchCloudflareProvisioningSettingsSchema),
    async (req, res) => {
      res.json(await updateCloudflareProvisioningSettings(req.body));
    },
  );

  router.post("/instance/settings/cloudflare/validate", async (req, res) => {
    assertCanManageInstanceSettings(req);
    const current = await getCloudflareProvisioningSettings();
    const tokenConfigured = cloudflareTokenConfigured();
    const missing = [
      current.enabled && !tokenConfigured ? "api token" : null,
      current.enabled && !current.accountId ? "account id" : null,
      current.enabled && !current.zoneId ? "zone id" : null,
      current.enabled && !current.dispatchNamespace ? "dispatch namespace" : null,
      current.enabled && !current.routingKvNamespaceId ? "routing KV namespace" : null,
    ].filter((item): item is string => Boolean(item));
    const message = current.enabled
      ? missing.length > 0
        ? `Missing ${missing.join(", ")}.`
        : null
      : "Cloudflare provisioning is disabled.";
    const checkedAt = new Date();
    const updated = await updateCloudflareProvisioningSettings({
      apiTokenConfigured: tokenConfigured,
      lastValidatedAt: checkedAt,
      lastValidationError: current.enabled && missing.length > 0 ? message : null,
    });
    res.json({
      ok: !current.enabled || missing.length === 0,
      checkedAt,
      accountReachable: !current.enabled || Boolean(updated.accountId),
      zoneReachable: !current.enabled || Boolean(updated.zoneId),
      dispatchNamespaceReachable: !current.enabled || Boolean(updated.dispatchNamespace),
      routingKvReachable: !current.enabled || Boolean(updated.routingKvNamespaceId),
      message,
    });
  });

  router.get("/instance/settings/admin-overview", async (req, res) => {
    assertBoardOrgAccess(req);
    const [tenants, cloudflare, jobs] = await Promise.all([
      listTenantResponses(),
      getCloudflareProvisioningSettings(),
      db.select().from(tenantProvisioningJobs).orderBy(desc(tenantProvisioningJobs.createdAt)),
    ]);
    const warnings = [
      cloudflare.enabled && !cloudflare.apiTokenConfigured ? "Cloudflare provisioning is enabled but no API token is configured." : null,
      cloudflare.enabled && !cloudflare.accountId ? "Cloudflare account ID is missing." : null,
      cloudflare.enabled && !cloudflare.zoneId ? "Cloudflare zone ID is missing." : null,
      cloudflare.lastValidationError,
    ].filter((warning): warning is string => Boolean(warning));
    const tenantById = new Map(tenants.map((tenant) => [tenant.id, tenant]));
    const overview: InstanceAdminOverview = {
      generatedAt: new Date(),
      cloudflare: {
        enabled: cloudflare.enabled,
        accountId: cloudflare.accountId,
        zoneName: cloudflare.zoneName,
        publicHostname: cloudflare.publicHostname,
        adminHostname: cloudflare.adminHostname,
        landingHostname: cloudflare.landingHostname,
        dispatchNamespace: cloudflare.dispatchNamespace,
        apiTokenConfigured: cloudflare.apiTokenConfigured,
        lastValidatedAt: cloudflare.lastValidatedAt,
        lastValidationError: cloudflare.lastValidationError,
      },
      tenants: {
        total: tenants.length,
        active: tenants.filter((tenant) => tenant.status === "active").length,
        provisioning: tenants.filter((tenant) => tenant.status === "provisioning").length,
        error: tenants.filter((tenant) => tenant.status === "error").length,
        paused: tenants.filter((tenant) => tenant.status === "paused").length,
        archived: tenants.filter((tenant) => tenant.status === "archived").length,
        bootstrapPending: tenants.filter((tenant) => tenant.bootstrapStatus === "pending").length,
      },
      jobs: {
        queued: jobs.filter((job) => job.status === "queued").length,
        running: jobs.filter((job) => job.status === "running").length,
        failed: jobs.filter((job) => job.status === "failed").length,
      },
      warnings,
      recentJobs: jobs.slice(0, 8).map((job) => ({
        id: job.id,
        tenantId: job.tenantId,
        tenantName: tenantById.get(job.tenantId)?.name ?? "Unknown tenant",
        status: job.status,
        step: job.step,
        errorMessage: job.errorMessage,
        createdAt: job.createdAt,
      })),
    };
    res.json(overview);
  });

  router.get("/instance/settings/tenants", async (req, res) => {
    assertBoardOrgAccess(req);
    res.json(await listTenantResponses());
  });

  router.post(
    "/instance/settings/tenants",
    (req, _res, next) => {
      try {
        assertCanManageInstanceSettings(req);
        next();
      } catch (error) {
        next(error);
      }
    },
    validate(createTenantInstanceSchema),
    async (req, res) => {
      const [provisioning, cloudflare] = await Promise.all([
        getTenantProvisioningSettings(),
        getCloudflareProvisioningSettings(),
      ]);
      const route = deriveTenantRoute(req.body, {
        pathTemplate: provisioning.pathTemplate,
        workerNameTemplate: provisioning.workerNameTemplate,
      });
      const now = new Date();
      const queued = cloudflare.enabled;
      const [created] = await db
        .insert(tenantInstances)
        .values({
          name: req.body.name,
          municipalityName: req.body.municipalityName,
          countryCode: route.countryCode,
          jurisdictionType: route.jurisdictionType,
          postalCode: route.postalCode,
          citySlug: route.citySlug,
          shortCode: route.shortCode,
          parentSubdivisionCode: route.parentSubdivisionCode,
          parentSubdivisionName: route.parentSubdivisionName,
          routingMode: req.body.routingMode ?? provisioning.defaultRoutingMode,
          status: queued ? "provisioning" : "active",
          pathPrefix: route.pathPrefix,
          dispatcherKey: route.dispatcherKey,
          hostname: req.body.hostname || null,
          workerName: route.workerName,
          dispatchScriptName: `${cloudflare.tenantWorkerScriptPrefix}-${route.countryCode}-${route.jurisdictionType}-${route.routeSegment}`,
          bootstrapStatus: "pending",
          lastDeploymentStartedAt: now,
          lastDeploymentFinishedAt: queued ? null : now,
          notes: req.body.notes || null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!created) throw new Error("Failed to create tenant");
      const job = await createProvisioningJob({
        tenantId: created.id,
        kind: "initial_provision",
        trigger: "tenant_created",
        queued,
      });
      res.status(201).json(toTenant(created, job, provisioning));
    },
  );

  router.patch(
    "/instance/settings/tenants/:tenantId",
    (req, _res, next) => {
      try {
        assertCanManageInstanceSettings(req);
        next();
      } catch (error) {
        next(error);
      }
    },
    validate(updateTenantInstanceSchema),
    async (req, res) => {
      const tenantId = req.params.tenantId as string;
      const existing = await loadTenantOrThrow(tenantId);
      const provisioning = await getTenantProvisioningSettings();
      const merged = {
        countryCode: req.body.countryCode ?? existing.countryCode,
        jurisdictionType: req.body.jurisdictionType ?? existing.jurisdictionType,
        postalCode: req.body.postalCode === undefined ? existing.postalCode : req.body.postalCode,
        citySlug: req.body.citySlug ?? existing.citySlug,
        shortCode: req.body.shortCode === undefined ? existing.shortCode : req.body.shortCode,
        parentSubdivisionCode: req.body.parentSubdivisionCode === undefined ? existing.parentSubdivisionCode : req.body.parentSubdivisionCode,
        parentSubdivisionName: req.body.parentSubdivisionName === undefined ? existing.parentSubdivisionName : req.body.parentSubdivisionName,
      };
      const route = deriveTenantRoute(merged, {
        pathTemplate: provisioning.pathTemplate,
        workerNameTemplate: provisioning.workerNameTemplate,
      });
      const [updated] = await db
        .update(tenantInstances)
        .set({
          name: req.body.name ?? existing.name,
          municipalityName: req.body.municipalityName ?? existing.municipalityName,
          countryCode: route.countryCode,
          jurisdictionType: route.jurisdictionType,
          postalCode: route.postalCode,
          citySlug: route.citySlug,
          shortCode: route.shortCode,
          parentSubdivisionCode: route.parentSubdivisionCode,
          parentSubdivisionName: route.parentSubdivisionName,
          routingMode: req.body.routingMode ?? existing.routingMode,
          status: req.body.status ?? existing.status,
          pathPrefix: route.pathPrefix,
          dispatcherKey: route.dispatcherKey,
          hostname: req.body.hostname === undefined ? existing.hostname : req.body.hostname || null,
          workerName: route.workerName,
          dispatchScriptName: existing.dispatchScriptName,
          notes: req.body.notes === undefined ? existing.notes : req.body.notes || null,
          updatedAt: new Date(),
        })
        .where(eq(tenantInstances.id, tenantId))
        .returning();
      const latest = (await latestJobsByTenant()).get(tenantId) ?? null;
      res.json(toTenant(updated ?? existing, latest, provisioning));
    },
  );

  router.get("/instance/settings/tenants/:tenantId/jobs", async (req, res) => {
    assertBoardOrgAccess(req);
    const tenantId = req.params.tenantId as string;
    await loadTenantOrThrow(tenantId);
    const jobs = await db
      .select()
      .from(tenantProvisioningJobs)
      .where(eq(tenantProvisioningJobs.tenantId, tenantId))
      .orderBy(desc(tenantProvisioningJobs.createdAt));
    res.json(jobs.map(toJob));
  });

  router.post("/instance/settings/tenants/:tenantId/redeploy", async (req, res) => {
    assertCanManageInstanceSettings(req);
    const tenantId = req.params.tenantId as string;
    const existing = await loadTenantOrThrow(tenantId);
    const [provisioning, cloudflare] = await Promise.all([
      getTenantProvisioningSettings(),
      getCloudflareProvisioningSettings(),
    ]);
    const now = new Date();
    const queued = cloudflare.enabled;
    const [updated] = await db
      .update(tenantInstances)
      .set({
        status: queued ? "provisioning" : "active",
        lastDeploymentStartedAt: now,
        lastDeploymentFinishedAt: queued ? null : now,
        lastDeploymentError: null,
        updatedAt: now,
      })
      .where(eq(tenantInstances.id, tenantId))
      .returning();
    const job = await createProvisioningJob({
      tenantId,
      kind: "redeploy",
      trigger: "manual_redeploy",
      queued,
    });
    res.json(toTenant(updated ?? existing, job, provisioning));
  });

  router.post("/instance/settings/tenants/:tenantId/pause", async (req, res) => {
    assertCanManageInstanceSettings(req);
    const tenantId = req.params.tenantId as string;
    const existing = await loadTenantOrThrow(tenantId);
    const provisioning = await getTenantProvisioningSettings();
    const [updated] = await db
      .update(tenantInstances)
      .set({ status: "paused", updatedAt: new Date() })
      .where(eq(tenantInstances.id, tenantId))
      .returning();
    const latest = (await latestJobsByTenant()).get(tenantId) ?? null;
    res.json(toTenant(updated ?? existing, latest, provisioning));
  });

  router.post("/instance/settings/tenants/:tenantId/archive", async (req, res) => {
    assertCanManageInstanceSettings(req);
    const tenantId = req.params.tenantId as string;
    const existing = await loadTenantOrThrow(tenantId);
    const provisioning = await getTenantProvisioningSettings();
    const [updated] = await db
      .update(tenantInstances)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(tenantInstances.id, tenantId))
      .returning();
    const job = await createProvisioningJob({
      tenantId,
      kind: "archive",
      trigger: "manual_archive",
      queued: false,
    });
    res.json(toTenant(updated ?? existing, job, provisioning));
  });

  return router;
}
