import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Router } from "express";
import { badRequest, notFound } from "../errors.js";
import {
  findServerAdapter,
  isOverridePaused,
  listServerAdapters,
  registerServerAdapter,
  setOverridePaused,
  unregisterServerAdapter,
} from "../adapters/index.js";
import {
  addAdapterPlugin,
  getAdapterPluginByType,
  getAdapterPluginsDir,
  getDisabledAdapterTypes,
  listAdapterPlugins,
  removeAdapterPlugin,
  setAdapterDisabled,
} from "../services/adapter-plugin-store.js";
import {
  loadExternalAdapterPackage,
  reloadExternalAdapter,
} from "../adapters/plugin-loader.js";
import { assertInstanceAdmin } from "./authz.js";

const execFileAsync = promisify(execFile);

function requirePackageName(value: unknown): string {
  const packageName = typeof value === "string" ? value.trim() : "";
  if (!packageName) throw badRequest("packageName is required");
  return packageName;
}

async function installPackage(packageName: string): Promise<void> {
  await execFileAsync("npm", ["install", packageName], {
    cwd: getAdapterPluginsDir(),
  });
}

function adapterPayload(type: string) {
  const adapter = findServerAdapter(type);
  const plugin = getAdapterPluginByType(type);
  return {
    type,
    installedPackage: plugin?.packageName ?? null,
    disabled: getDisabledAdapterTypes().includes(type),
    overridePaused: isOverridePaused(type),
    models: adapter?.models ?? [],
  };
}

export function adapterRoutes(): Router {
  const router = Router();

  router.get("/adapters", (_req, res) => {
    const pluginTypes = new Set(listAdapterPlugins().map((plugin) => plugin.type));
    const types = new Set([
      ...listServerAdapters().map((adapter) => adapter.type),
      ...pluginTypes,
    ]);
    res.json(Array.from(types).sort().map(adapterPayload));
  });

  router.post("/adapters/install", async (req, res) => {
    assertInstanceAdmin(req);
    const packageName = requirePackageName(req.body?.packageName);
    await installPackage(packageName);
    const adapter = await loadExternalAdapterPackage(packageName);
    registerServerAdapter(adapter);
    addAdapterPlugin({
      packageName,
      type: adapter.type,
      installedAt: new Date().toISOString(),
    });
    res.status(201).json(adapterPayload(adapter.type));
  });

  router.patch("/adapters/:type", (req, res) => {
    assertInstanceAdmin(req);
    const type = req.params.type as string;
    setAdapterDisabled(type, Boolean(req.body?.disabled));
    res.json(adapterPayload(type));
  });

  router.patch("/adapters/:type/override", (req, res) => {
    assertInstanceAdmin(req);
    const type = req.params.type as string;
    setOverridePaused(type, Boolean(req.body?.paused));
    res.json(adapterPayload(type));
  });

  router.delete("/adapters/:type", (req, res) => {
    assertInstanceAdmin(req);
    const type = req.params.type as string;
    unregisterServerAdapter(type);
    removeAdapterPlugin(type);
    res.json({ type, removed: true });
  });

  router.post("/adapters/:type/reload", async (req, res) => {
    assertInstanceAdmin(req);
    const type = req.params.type as string;
    const adapter = await reloadExternalAdapter(type);
    registerServerAdapter(adapter);
    res.json(adapterPayload(adapter.type));
  });

  router.post("/adapters/:type/reinstall", async (req, res) => {
    assertInstanceAdmin(req);
    const type = req.params.type as string;
    const plugin = getAdapterPluginByType(type);
    if (!plugin) throw notFound("External adapter is not installed");
    await installPackage(plugin.packageName);
    const adapter = await loadExternalAdapterPackage(plugin.packageName);
    registerServerAdapter(adapter);
    addAdapterPlugin({
      ...plugin,
      type: adapter.type,
      installedAt: new Date().toISOString(),
    });
    res.json(adapterPayload(adapter.type));
  });

  return router;
}
