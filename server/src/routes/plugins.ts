import { Router, type Request, type Response } from "express";
import type { Db } from "@paperclipai/db";
import {
  PLUGIN_STATUSES,
  type PaperclipPluginManifestV1,
  type PluginApiRouteDeclaration,
  type PluginStatus,
} from "@paperclipai/shared";
import { pluginRegistryService } from "../services/plugin-registry.js";
import { issueService } from "../services/issues.js";
import { getPluginUiContributionMetadata } from "../services/plugin-loader.js";

type WorkerManager = {
  isRunning(pluginId: string): boolean;
  call(pluginId: string, method: string, params: unknown, timeoutMs?: number): Promise<unknown>;
};

type PluginRow = {
  id: string;
  pluginKey?: string;
  status?: string;
  manifestJson?: PaperclipPluginManifestV1;
};

const FORWARDED_RESPONSE_HEADERS = new Set([
  "cache-control",
  "etag",
  "expires",
  "last-modified",
  "x-request-id",
  "x-plugin-request-id",
]);

function extractWorkerManager(...candidates: unknown[]): WorkerManager | null {
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const direct = candidate as Partial<WorkerManager>;
    if (typeof direct.isRunning === "function" && typeof direct.call === "function") {
      return direct as WorkerManager;
    }
    const wrapped = (candidate as { workerManager?: unknown }).workerManager;
    if (wrapped && typeof wrapped === "object") {
      const manager = wrapped as Partial<WorkerManager>;
      if (typeof manager.isRunning === "function" && typeof manager.call === "function") {
        return manager as WorkerManager;
      }
    }
  }
  return null;
}

function readApiPath(req: Request) {
  const raw = req.params.apiPath;
  const path = Array.isArray(raw) ? raw.join("/") : String(raw ?? "");
  return `/${path}`.replace(/\/+/g, "/");
}

function matchRoute(routePath: string, requestPath: string) {
  const routeSegments = routePath.split("/").filter(Boolean);
  const requestSegments = requestPath.split("/").filter(Boolean);
  if (routeSegments.length !== requestSegments.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < routeSegments.length; i += 1) {
    const routeSegment = routeSegments[i] as string;
    const requestSegment = requestSegments[i] as string;
    if (routeSegment.startsWith(":")) {
      params[routeSegment.slice(1)] = decodeURIComponent(requestSegment);
      continue;
    }
    if (routeSegment !== requestSegment) return null;
  }
  return params;
}

function queryToObject(req: Request) {
  const query: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(req.query)) {
    if (Array.isArray(value)) {
      query[key] = value.map((item) => String(item));
    } else if (value !== undefined && value !== null && typeof value !== "object") {
      query[key] = String(value);
    }
  }
  return query;
}

function readQueryString(req: Request, key: string) {
  const value = req.query[key];
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : undefined;
  return typeof value === "string" ? value : undefined;
}

function actorPayload(req: Request) {
  if (req.actor.type === "agent") {
    const agentId = req.actor.agentId ?? "unknown-agent";
    return {
      actorType: "agent" as const,
      actorId: agentId,
      agentId,
      userId: null,
      runId: req.actor.runId ?? null,
    };
  }
  const userId = req.actor.userId ?? "board";
  return {
    actorType: "user" as const,
    actorId: userId,
    agentId: null,
    userId,
    runId: null,
  };
}

function canAccessCompany(req: Request, companyId: string) {
  if (req.actor.type === "agent") return req.actor.companyId === companyId;
  return req.actor.isInstanceAdmin || (req.actor.companyIds ?? []).includes(companyId);
}

function sanitizeRequestHeaders(req: Request) {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    if (lower === "authorization" || lower === "cookie" || lower === "set-cookie") continue;
    if (Array.isArray(value)) {
      headers[lower] = value.join(", ");
    } else if (typeof value === "string") {
      headers[lower] = value;
    }
  }
  return headers;
}

function forwardResponseHeaders(res: Response, headers: unknown) {
  if (!headers || typeof headers !== "object") return;
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (!FORWARDED_RESPONSE_HEADERS.has(lower)) continue;
    if (typeof value === "string") res.set(lower, value);
  }
}

function responseStatus(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : 200;
}

function isPluginStatus(value: unknown): value is PluginStatus {
  return typeof value === "string" && (PLUGIN_STATUSES as readonly string[]).includes(value);
}

async function enforceRouteAuth(req: Request, res: Response, route: PluginApiRouteDeclaration) {
  if (route.auth === "board" && req.actor.type !== "board") {
    res.status(403).json({ error: "Board access required" });
    return false;
  }
  if (route.auth === "agent" && req.actor.type !== "agent") {
    res.status(403).json({ error: "Agent access required" });
    return false;
  }
  return true;
}

export function pluginRoutes(
  db: Db,
  _loader: unknown,
  _scheduler: unknown,
  workerManagerCandidate: unknown,
  _toolDispatcher: unknown,
  workerManagerCandidate2: unknown,
): Router {
  const router = Router();
  const registry = pluginRegistryService(db);
  const issues = issueService(db);
  const workerManager = extractWorkerManager(workerManagerCandidate2, workerManagerCandidate);

  router.get("/plugins", async (req, res, next) => {
    try {
      const status = req.query.status;
      if (status !== undefined && !isPluginStatus(status)) {
        res.status(400).json({ error: "Invalid plugin status" });
        return;
      }
      res.json(status ? await registry.listByStatus(status) : await registry.listInstalled());
    } catch (error) {
      next(error);
    }
  });

  router.get("/plugins/examples", (_req, res) => {
    res.json([]);
  });

  router.get("/plugins/ui-contributions", async (_req, res, next) => {
    try {
      const readyPlugins = await registry.listByStatus("ready");
      res.json(readyPlugins.flatMap((plugin) => {
        const manifest = plugin.manifestJson as PaperclipPluginManifestV1 | undefined;
        if (!manifest?.entrypoints?.ui) return [];
        const metadata = getPluginUiContributionMetadata(manifest);
        if (!metadata) return [];
        const updatedAt = plugin.updatedAt instanceof Date
          ? plugin.updatedAt.toISOString()
          : typeof plugin.updatedAt === "string"
            ? plugin.updatedAt
            : undefined;
        return [{
          pluginId: plugin.id,
          pluginKey: plugin.pluginKey,
          displayName: manifest.displayName,
          version: plugin.version,
          updatedAt,
          uiEntryFile: metadata.uiEntryFile,
          slots: metadata.slots,
          launchers: metadata.launchers,
        }];
      }));
    } catch (error) {
      next(error);
    }
  });

  router.get("/plugins/:pluginId", async (req, res, next) => {
    try {
      const pluginId = req.params.pluginId as string;
      const plugin = await registry.getById(pluginId) ?? await registry.getByKey(pluginId);
      if (!plugin || plugin.status === "uninstalled") {
        res.status(404).json({ error: "Plugin not found" });
        return;
      }
      res.json(plugin);
    } catch (error) {
      next(error);
    }
  });

  router.all("/plugins/:pluginId/api/*apiPath", async (req, res, next) => {
    try {
      const pluginId = req.params.pluginId as string;
      const plugin = await registry.getById(pluginId) as PluginRow | null
        ?? await registry.getByKey(pluginId) as PluginRow | null;
      if (!plugin) {
        res.status(404).json({ error: "Plugin not found" });
        return;
      }
      if (plugin.status === "disabled") {
        res.status(503).json({ error: `Plugin ${plugin.pluginKey ?? plugin.id} is disabled` });
        return;
      }
      if (plugin.status && plugin.status !== "ready") {
        res.status(503).json({ error: `Plugin ${plugin.pluginKey ?? plugin.id} is not ready` });
        return;
      }
      if (!workerManager || !workerManager.isRunning(plugin.id)) {
        res.status(503).json({ error: `Plugin ${plugin.pluginKey ?? plugin.id} worker is not running` });
        return;
      }

      const manifest = plugin.manifestJson;
      const apiRoutes = manifest?.apiRoutes ?? [];
      const requestPath = readApiPath(req);
      const method = req.method.toUpperCase();
      let matched: { route: PluginApiRouteDeclaration; params: Record<string, string> } | null = null;
      for (const route of apiRoutes) {
        if (route.method !== method) continue;
        const params = matchRoute(route.path, requestPath);
        if (!params) continue;
        matched = { route, params };
        break;
      }
      if (!matched) {
        res.status(404).json({ error: "Plugin API route not found" });
        return;
      }

      const { route, params } = matched;
      if (!(await enforceRouteAuth(req, res, route))) return;
      if (manifest?.capabilities && !manifest.capabilities.includes(route.capability)) {
        res.status(403).json({ error: `Plugin capability '${route.capability}' is not granted` });
        return;
      }

      let companyId: string | undefined;
      let scopedIssue: Awaited<ReturnType<ReturnType<typeof issueService>["getById"]>> | null = null;
      if (route.companyResolution?.from === "query") {
        companyId = readQueryString(req, route.companyResolution.key);
      } else if (route.companyResolution?.from === "issue") {
        const issueId = params[route.companyResolution.param];
        if (!issueId) {
          res.status(400).json({ error: "Issue route parameter is missing" });
          return;
        }
        scopedIssue = await issues.getById(issueId);
        if (!scopedIssue) {
          res.status(404).json({ error: "Issue not found" });
          return;
        }
        companyId = scopedIssue.companyId;
      } else if (req.actor.type === "agent") {
        companyId = req.actor.companyId;
      }

      if (!companyId) {
        res.status(400).json({ error: "Plugin API route could not resolve a company" });
        return;
      }
      if (!canAccessCompany(req, companyId)) {
        res.status(403).json({ error: "Actor cannot access this company" });
        return;
      }

      if (req.actor.type === "agent" && route.checkoutPolicy && route.checkoutPolicy !== "none") {
        const issueId = scopedIssue?.id ?? params.issueId;
        if (!issueId) {
          res.status(400).json({ error: "Checkout-protected route requires an issue id" });
          return;
        }
        const shouldCheckOwnership = route.checkoutPolicy === "always-for-agent"
          || (route.checkoutPolicy === "required-for-agent-in-progress"
            && scopedIssue?.status === "in_progress"
            && scopedIssue.assigneeAgentId === req.actor.agentId);
        if (shouldCheckOwnership) {
          if (!req.actor.runId) {
            res.status(401).json({ error: "Agent run id is required for checkout-protected plugin routes" });
            return;
          }
          try {
            await issues.assertCheckoutOwner?.(issueId, req.actor.agentId ?? "", req.actor.runId);
          } catch (error) {
            const status = typeof (error as { status?: unknown }).status === "number"
              ? (error as { status: number }).status
              : 409;
            res.status(status).json({ error: error instanceof Error ? error.message : "Issue checkout ownership conflict" });
            return;
          }
        }
      }

      const workerResult = await workerManager.call(plugin.id, "handleApiRequest", {
        routeKey: route.routeKey,
        method,
        path: requestPath,
        params,
        query: queryToObject(req),
        body: req.body,
        actor: actorPayload(req),
        companyId,
        headers: sanitizeRequestHeaders(req),
      }) as { status?: number; headers?: Record<string, string>; body?: unknown } | null;

      forwardResponseHeaders(res, workerResult?.headers);
      res.status(responseStatus(workerResult?.status)).json(workerResult?.body ?? null);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export default pluginRoutes;
