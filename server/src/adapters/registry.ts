import type {
  AdapterModelProfileDefinition,
  AdapterRuntimeCommandSpec,
  ServerAdapterModule,
} from "./types.js";
import { parseAdapterModelsEnv } from "../services/adapter-models-env.js";
import { stampClaudeAgentIdHeader } from "./claude-agent-id-header.js";
import {
  buildSandboxNpmInstallCommand,
  getAdapterSessionManagement,
} from "@paperclipai/adapter-utils";
import {
  execute as claudeExecute,
  listClaudeSkills,
  syncClaudeSkills,
  listClaudeModels,
  refreshClaudeModels,
  testEnvironment as claudeTestEnvironment,
  sessionCodec as claudeSessionCodec,
  getQuotaWindows as claudeGetQuotaWindows,
  getConfigSchema as getClaudeConfigSchema,
} from "@paperclipai/adapter-claude-local/server";
import {
  agentConfigurationDoc as claudeAgentConfigurationDoc,
  models as claudeModels,
  modelProfiles as claudeModelProfiles,
} from "@paperclipai/adapter-claude-local";
import {
  execute as codexExecute,
  listCodexSkills,
  syncCodexSkills,
  testEnvironment as codexTestEnvironment,
  sessionCodec as codexSessionCodec,
  getQuotaWindows as codexGetQuotaWindows,
  getConfigSchema as getCodexConfigSchema,
} from "@paperclipai/adapter-codex-local/server";
import {
  agentConfigurationDoc as codexAgentConfigurationDoc,
  models as codexModels,
  modelProfiles as codexModelProfiles,
} from "@paperclipai/adapter-codex-local";
import {
  execute as cursorExecute,
  testEnvironment as cursorTestEnvironment,
  sessionCodec as cursorSessionCodec,
} from "@paperclipai/adapter-cursor-local/server";
import {
  agentConfigurationDoc as cursorAgentConfigurationDoc,
  models as cursorModels,
  modelProfiles as cursorModelProfiles,
} from "@paperclipai/adapter-cursor-local";
import {
  execute as cursorCloudExecute,
  getConfigSchema as getCursorCloudConfigSchema,
  sessionCodec as cursorCloudSessionCodec,
  testEnvironment as cursorCloudTestEnvironment,
} from "@paperclipai/adapter-cursor-cloud/server";
import { agentConfigurationDoc as cursorCloudAgentConfigurationDoc } from "@paperclipai/adapter-cursor-cloud";
import {
  execute as geminiExecute,
  listGeminiSkills,
  syncGeminiSkills,
  testEnvironment as geminiTestEnvironment,
  sessionCodec as geminiSessionCodec,
  getConfigSchema as getGeminiConfigSchema,
} from "@paperclipai/adapter-gemini-local/server";
import {
  agentConfigurationDoc as geminiAgentConfigurationDoc,
  models as geminiModels,
} from "@paperclipai/adapter-gemini-local";
import {
  execute as grokExecute,
  listGrokSkills,
  syncGrokSkills,
  testEnvironment as grokTestEnvironment,
  sessionCodec as grokSessionCodec,
} from "@paperclipai/adapter-grok-local/server";
import {
  agentConfigurationDoc as grokAgentConfigurationDoc,
  models as grokModels,
} from "@paperclipai/adapter-grok-local";
import {
  createHermesGatewayServerAdapter,
  createHermesLocalServerAdapter,
} from "@paperclipai/hermes-paperclip-adapter";
import {
  execute as openCodeExecute,
  testEnvironment as openCodeTestEnvironment,
  sessionCodec as openCodeSessionCodec,
  listOpenCodeModels,
} from "@paperclipai/adapter-opencode-local/server";
import {
  agentConfigurationDoc as openCodeAgentConfigurationDoc,
  models as openCodeModels,
  modelProfiles as openCodeModelProfiles,
} from "@paperclipai/adapter-opencode-local";
import {
  execute as openclawGatewayExecute,
  testEnvironment as openclawGatewayTestEnvironment,
} from "@paperclipai/adapter-openclaw-gateway/server";
import {
  agentConfigurationDoc as openclawGatewayAgentConfigurationDoc,
  models as openclawGatewayModels,
} from "@paperclipai/adapter-openclaw-gateway";
import {
  execute as cloudflareWorkersAiExecute,
  testEnvironment as cloudflareWorkersAiTestEnvironment,
} from "@ciutatis/adapter-cloudflare-workers-ai/server";
import {
  agentConfigurationDoc as cloudflareWorkersAiAgentConfigurationDoc,
  models as cloudflareWorkersAiModels,
} from "@ciutatis/adapter-cloudflare-workers-ai";
import { listCodexModels, refreshCodexModels } from "./codex-models.js";
import { listCursorModels } from "./cursor-models.js";
import {
  execute as piExecute,
  testEnvironment as piTestEnvironment,
  sessionCodec as piSessionCodec,
  listPiModels,
} from "@paperclipai/adapter-pi-local/server";
import {
  agentConfigurationDoc as piAgentConfigurationDoc,
  modelProfiles as piModelProfiles,
} from "@paperclipai/adapter-pi-local";
import { BUILTIN_ADAPTER_TYPES } from "./builtin-adapter-types.js";
import { buildExternalAdapters } from "./plugin-loader.js";
import { getDisabledAdapterTypes } from "../services/adapter-plugin-store.js";
import { processAdapter } from "./process/index.js";
import { httpAdapter } from "./http/index.js";

function readConfiguredCommand(config: Record<string, unknown>, fallback: string): string {
  const value = typeof config.command === "string" ? config.command.trim() : "";
  return value.length > 0 ? value : fallback;
}

function hasPathSeparator(command: string): boolean {
  return command.includes("/") || command.includes("\\");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function buildNpmRuntimeCommandSpec(
  config: Record<string, unknown>,
  fallbackCommand: string,
  packageName: string,
): AdapterRuntimeCommandSpec {
  const command = readConfiguredCommand(config, fallbackCommand);
  const canSelfInstall = !hasPathSeparator(command) && command === fallbackCommand;
  const installLine = buildSandboxNpmInstallCommand(packageName);
  return {
    command,
    detectCommand: command,
    installCommand: canSelfInstall
      ? `if ! command -v ${shellQuote(command)} >/dev/null 2>&1; then ${installLine}; fi`
      : null,
  };
}

function buildCursorRuntimeCommandSpec(config: Record<string, unknown>): AdapterRuntimeCommandSpec {
  const command = readConfiguredCommand(config, "agent");
  return {
    command,
    detectCommand: command,
    installCommand: null,
  };
}

const retiredAcpxMessage =
  "The acpx_local adapter has been retired. Existing Claude and Codex ACPX agents should be migrated to claude_local or codex_local with adapterConfig.engine=\"acp\".";

const retiredAcpxAgentConfigurationDoc = `# acpx_local retired

Adapter: acpx_local

The standalone ACPX adapter has been retired. Use:

- claude_local with adapterConfig.engine="acp" for Claude ACP execution.
- codex_local with adapterConfig.engine="acp" for Codex ACP execution.

Paperclip keeps this tombstone registered so stale acpx_local rows fail clearly instead of falling back to the process adapter.
`;

const claudeLocalAdapter: ServerAdapterModule = {
  type: "claude_local",
  execute: stampClaudeAgentIdHeader(claudeExecute),
  testEnvironment: claudeTestEnvironment,
  acp: {
    agentId: "claude",
    skillsMode: "ephemeral",
    prerequisites: {
      nodeRange: ">=22.12.0",
      packages: ["@agentclientprotocol/claude-agent-acp"],
    },
  },
  listSkills: listClaudeSkills,
  syncSkills: syncClaudeSkills,
  sessionCodec: claudeSessionCodec,
  sessionManagement: getAdapterSessionManagement("claude_local") ?? undefined,
  models: claudeModels,
  modelProfiles: claudeModelProfiles,
  listModels: listClaudeModels,
  refreshModels: refreshClaudeModels,
  supportsLocalAgentJwt: true,
  supportsInstructionsBundle: true,
  instructionsPathKey: "instructionsFilePath",
  requiresMaterializedRuntimeSkills: false,
  getRuntimeCommandSpec: (config) => buildNpmRuntimeCommandSpec(config, "claude", "@anthropic-ai/claude-code"),
  agentConfigurationDoc: claudeAgentConfigurationDoc,
  getConfigSchema: getClaudeConfigSchema,
  getQuotaWindows: claudeGetQuotaWindows,
};

const acpxLocalAdapter: ServerAdapterModule = {
  type: "acpx_local",
  async execute(ctx) {
    await ctx.onLog("stderr", `${retiredAcpxMessage}\n`);
    await ctx.onMeta?.({
      adapterType: "acpx_local",
      command: "acpx_local-retired",
      commandNotes: [retiredAcpxMessage],
    });
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorMessage: retiredAcpxMessage,
      errorCode: "acpx_local_retired",
      provider: "acpx",
      summary: retiredAcpxMessage,
    };
  },
  async testEnvironment() {
    return {
      adapterType: "acpx_local",
      status: "fail",
      testedAt: new Date().toISOString(),
      checks: [
        {
          code: "acpx_local_retired",
          level: "error",
          message: retiredAcpxMessage,
          hint: "Set the agent adapter to claude_local or codex_local and set adapterConfig.engine to acp.",
        },
      ],
    };
  },
  models: [],
  supportsLocalAgentJwt: false,
  supportsInstructionsBundle: false,
  requiresMaterializedRuntimeSkills: false,
  agentConfigurationDoc: retiredAcpxAgentConfigurationDoc,
  getConfigSchema: () => ({ fields: [] }),
};

const codexLocalAdapter: ServerAdapterModule = {
  type: "codex_local",
  execute: codexExecute,
  testEnvironment: codexTestEnvironment,
  acp: {
    agentId: "codex",
    skillsMode: "ephemeral",
    prerequisites: {
      nodeRange: ">=22.13.0",
      packages: ["@agentclientprotocol/codex-acp"],
    },
  },
  listSkills: listCodexSkills,
  syncSkills: syncCodexSkills,
  sessionCodec: codexSessionCodec,
  sessionManagement: getAdapterSessionManagement("codex_local") ?? undefined,
  models: codexModels,
  modelProfiles: codexModelProfiles,
  listModels: listCodexModels,
  refreshModels: refreshCodexModels,
  supportsLocalAgentJwt: true,
  supportsInstructionsBundle: true,
  instructionsPathKey: "instructionsFilePath",
  requiresMaterializedRuntimeSkills: false,
  getRuntimeCommandSpec: (config) => buildNpmRuntimeCommandSpec(config, "codex", "@openai/codex"),
  agentConfigurationDoc: codexAgentConfigurationDoc,
  getConfigSchema: getCodexConfigSchema,
  getQuotaWindows: codexGetQuotaWindows,
};

const cursorLocalAdapter: ServerAdapterModule = {
  type: "cursor",
  execute: cursorExecute,
  testEnvironment: cursorTestEnvironment,
  sessionCodec: cursorSessionCodec,
  sessionManagement: getAdapterSessionManagement("cursor") ?? undefined,
  models: cursorModels,
  modelProfiles: cursorModelProfiles,
  listModels: listCursorModels,
  supportsLocalAgentJwt: true,
  supportsInstructionsBundle: true,
  instructionsPathKey: "instructionsFilePath",
  requiresMaterializedRuntimeSkills: true,
  getRuntimeCommandSpec: buildCursorRuntimeCommandSpec,
  agentConfigurationDoc: cursorAgentConfigurationDoc,
};

const cursorCloudAdapter: ServerAdapterModule = {
  type: "cursor_cloud",
  execute: cursorCloudExecute,
  testEnvironment: cursorCloudTestEnvironment,
  sessionCodec: cursorCloudSessionCodec,
  sessionManagement: getAdapterSessionManagement("cursor_cloud") ?? undefined,
  models: [],
  supportsLocalAgentJwt: false,
  supportsInstructionsBundle: true,
  instructionsPathKey: "instructionsFilePath",
  requiresMaterializedRuntimeSkills: false,
  agentConfigurationDoc: cursorCloudAgentConfigurationDoc,
  getConfigSchema: getCursorCloudConfigSchema,
};

const geminiLocalAdapter: ServerAdapterModule = {
  type: "gemini_local",
  execute: geminiExecute,
  testEnvironment: geminiTestEnvironment,
  acp: {
    agentId: "gemini",
    skillsMode: "ephemeral",
    prerequisites: {
      nodeRange: ">=20.0.0",
      packages: ["@google/gemini-cli"],
    },
  },
  listSkills: listGeminiSkills,
  syncSkills: syncGeminiSkills,
  sessionCodec: geminiSessionCodec,
  sessionManagement: getAdapterSessionManagement("gemini_local") ?? undefined,
  models: geminiModels,
  listModels: async () => geminiModels,
  supportsLocalAgentJwt: true,
  supportsInstructionsBundle: true,
  instructionsPathKey: "instructionsFilePath",
  requiresMaterializedRuntimeSkills: true,
  getRuntimeCommandSpec: (config) => buildNpmRuntimeCommandSpec(config, "gemini", "@google/gemini-cli"),
  agentConfigurationDoc: geminiAgentConfigurationDoc,
  getConfigSchema: getGeminiConfigSchema,
};

const grokLocalAdapter: ServerAdapterModule = {
  type: "grok_local",
  execute: grokExecute,
  testEnvironment: grokTestEnvironment,
  listSkills: listGrokSkills,
  syncSkills: syncGrokSkills,
  sessionCodec: grokSessionCodec,
  sessionManagement: getAdapterSessionManagement("grok_local") ?? undefined,
  models: grokModels,
  supportsLocalAgentJwt: true,
  supportsInstructionsBundle: true,
  instructionsPathKey: "instructionsFilePath",
  requiresMaterializedRuntimeSkills: true,
  getRuntimeCommandSpec: (config) => ({
    command: readConfiguredCommand(config, "grok"),
    detectCommand: readConfiguredCommand(config, "grok"),
    installCommand: null,
  }),
  agentConfigurationDoc: grokAgentConfigurationDoc,
};

const hermesGatewayAdapter = createHermesGatewayServerAdapter();

const hermesLocalAdapter = createHermesLocalServerAdapter();

const openclawGatewayAdapter: ServerAdapterModule = {
  type: "openclaw_gateway",
  execute: openclawGatewayExecute,
  testEnvironment: openclawGatewayTestEnvironment,
  models: openclawGatewayModels,
  supportsLocalAgentJwt: false,
  supportsInstructionsBundle: false,
  requiresMaterializedRuntimeSkills: false,
  agentConfigurationDoc: openclawGatewayAgentConfigurationDoc,
};

const openCodeLocalAdapter: ServerAdapterModule = {
  type: "opencode_local",
  execute: openCodeExecute,
  testEnvironment: openCodeTestEnvironment,
  sessionCodec: openCodeSessionCodec,
  models: openCodeModels,
  modelProfiles: openCodeModelProfiles,
  sessionManagement: getAdapterSessionManagement("opencode_local") ?? undefined,
  listModels: listOpenCodeModels,
  supportsLocalAgentJwt: true,
  supportsInstructionsBundle: true,
  instructionsPathKey: "instructionsFilePath",
  requiresMaterializedRuntimeSkills: true,
  getRuntimeCommandSpec: (config) => buildNpmRuntimeCommandSpec(config, "opencode", "opencode-ai"),
  agentConfigurationDoc: openCodeAgentConfigurationDoc,
};

const cloudflareWorkersAiAdapter: ServerAdapterModule = {
  type: "cloudflare_workers_ai",
  execute: cloudflareWorkersAiExecute,
  testEnvironment: cloudflareWorkersAiTestEnvironment,
  models: cloudflareWorkersAiModels,
  listModels: async () => cloudflareWorkersAiModels,
  supportsLocalAgentJwt: false,
  supportsInstructionsBundle: true,
  instructionsPathKey: "instructionsFilePath",
  requiresMaterializedRuntimeSkills: false,
  agentConfigurationDoc: cloudflareWorkersAiAgentConfigurationDoc,
};

const piLocalAdapter: ServerAdapterModule = {
  type: "pi_local",
  execute: piExecute,
  testEnvironment: piTestEnvironment,
  sessionCodec: piSessionCodec,
  sessionManagement: getAdapterSessionManagement("pi_local") ?? undefined,
  models: [],
  modelProfiles: piModelProfiles,
  listModels: listPiModels,
  supportsLocalAgentJwt: true,
  supportsInstructionsBundle: true,
  instructionsPathKey: "instructionsFilePath",
  requiresMaterializedRuntimeSkills: true,
  getRuntimeCommandSpec: (config) => buildNpmRuntimeCommandSpec(config, "pi", "@mariozechner/pi-coding-agent"),
  agentConfigurationDoc: piAgentConfigurationDoc,
};

const adaptersByType = new Map<string, ServerAdapterModule>();

// For builtin types that are overridden by an external adapter, we keep the
// original builtin so it can be restored when the override is deactivated.
const builtinFallbacks = new Map<string, ServerAdapterModule>();

// Tracks which override types are currently deactivated (paused).  When
// paused, `getServerAdapter()` returns the builtin fallback instead of the
// external.  Persisted across reloads via the same disabled-adapters store.
const pausedOverrides = new Set<string>();

function registerBuiltInAdapters() {
  for (const adapter of [
    acpxLocalAdapter,
    claudeLocalAdapter,
    codexLocalAdapter,
    openCodeLocalAdapter,
    piLocalAdapter,
    cursorCloudAdapter,
    cursorLocalAdapter,
    geminiLocalAdapter,
    grokLocalAdapter,
    hermesGatewayAdapter,
    hermesLocalAdapter,
    openclawGatewayAdapter,
    cloudflareWorkersAiAdapter,
    processAdapter,
    httpAdapter,
  ]) {
    adaptersByType.set(adapter.type, adapter);
  }
}

registerBuiltInAdapters();

// ---------------------------------------------------------------------------
// Load external adapter plugins (e.g. droid_local)
//
// External adapter packages export createServerAdapter() which returns a
// ServerAdapterModule. When the module provides its own sessionManagement
// it is preserved; otherwise the host falls back to the built-in registry
// lookup (so externals that override a built-in type inherit the builtin's
// policy). This brings init-time registration to at-least-as-good behavior
// as the hot-install path (routes/adapters.ts:179 -> registerServerAdapter):
// both preserve module-provided sessionManagement, and init-time additionally
// applies the registry fallback for externals overriding a built-in type.
// ---------------------------------------------------------------------------

/** Cached sync wrapper — the store is a simple JSON file read, safe to call frequently. */
function getDisabledAdapterTypesFromStore(): string[] {
  return getDisabledAdapterTypes();
}

/**
 * Merge an external adapter module with host-provided session management.
 *
 * Module-provided `sessionManagement` takes precedence. When absent, fall
 * back to the hardcoded registry keyed by adapter type (so externals that
 * override a built-in — same `type` — inherit the builtin's policy). If
 * neither is available, `sessionManagement` remains `undefined`.
 *
 * Used by both the init-time IIFE below (external-adapter load pass on
 * server start) and the hot-install path in `routes/adapters.ts`
 * (`registerWithSessionManagement`), so the two load paths resolve
 * `sessionManagement` identically.
 */
export function resolveExternalAdapterRegistration(
  externalAdapter: ServerAdapterModule,
): ServerAdapterModule {
  return {
    ...externalAdapter,
    sessionManagement:
      externalAdapter.sessionManagement
        ?? getAdapterSessionManagement(externalAdapter.type)
        ?? undefined,
  };
}

export function getServerAdapter(type: string): ServerAdapterModule {
  return adaptersByType.get(type) ?? processAdapter;
}

export function findServerAdapter(type: string): ServerAdapterModule | null {
  return adaptersByType.get(type) ?? null;
}

export function findActiveServerAdapter(type: string): ServerAdapterModule | null {
  if (pausedOverrides.has(type)) return null;
  return findServerAdapter(type);
}

export function requireServerAdapter(type: string): ServerAdapterModule {
  const adapter = findActiveServerAdapter(type);
  if (!adapter) throw new Error(`Unknown adapter type: ${type}`);
  return adapter;
}

export function listServerAdapters(): ServerAdapterModule[] {
  return Array.from(adaptersByType.values());
}

/**
 * Memoized view of PAPERCLIP_ADAPTER_MODELS, keyed by the raw env string so
 * tests (and live env mutation) that change the variable are still observed.
 * Parsing happens at most once per distinct raw value instead of per
 * `listAdapterModels` request, and malformed values fail SOFT here: we log the
 * parse error once (per distinct raw value) and fall back to adapter-discovered
 * models rather than throwing at request time.
 */
let adapterModelsEnvCache: {
  raw: string | undefined;
  value: ReturnType<typeof parseAdapterModelsEnv>;
} | null = null;

function getDeclaredAdapterModels(): ReturnType<typeof parseAdapterModelsEnv> {
  const raw = process.env.PAPERCLIP_ADAPTER_MODELS;
  if (adapterModelsEnvCache && adapterModelsEnvCache.raw === raw) {
    return adapterModelsEnvCache.value;
  }
  let value: ReturnType<typeof parseAdapterModelsEnv> = null;
  try {
    value = parseAdapterModelsEnv(process.env);
  } catch (err) {
    console.error(
      "[paperclip] Invalid PAPERCLIP_ADAPTER_MODELS; ignoring declared model lists:",
      err,
    );
  }
  adapterModelsEnvCache = { raw, value };
  return value;
}

export async function listAdapterModels(type: string): Promise<{ id: string; label: string }[]> {
  const declaredModels = getDeclaredAdapterModels();
  if (declaredModels && declaredModels[type]?.length) {
    return declaredModels[type].map((m) => ({ id: m.id, label: m.label ?? m.id }));
  }
  const adapter = findActiveServerAdapter(type);
  if (!adapter) return [];
  if (adapter.listModels) return adapter.listModels();
  return adapter.models ?? [];
}

export async function refreshAdapterModels(type: string): Promise<{ id: string; label: string }[]> {
  const adapter = findActiveServerAdapter(type);
  if (!adapter) return [];
  if (adapter.refreshModels) return adapter.refreshModels();
  if (adapter.listModels) return adapter.listModels();
  return adapter.models ?? [];
}

export async function listAdapterModelProfiles(type: string): Promise<AdapterModelProfileDefinition[]> {
  const adapter = findActiveServerAdapter(type);
  if (!adapter) return [];
  return adapter.modelProfiles ?? [];
}

export async function detectAdapterModel(
  _type: string,
): Promise<{ model: string; provider: string; source: string; candidates?: string[] } | null> {
  return null;
}

export const waitForExternalAdapters: Promise<void> = Promise.resolve();

export function registerServerAdapter(adapter: ServerAdapterModule): void {
  adaptersByType.set(adapter.type, adapter);
}

export function unregisterServerAdapter(type: string): void {
  if (type === processAdapter.type || type === httpAdapter.type) return;
  adaptersByType.delete(type);
  pausedOverrides.delete(type);
}

export function setOverridePaused(type: string, paused: boolean): void {
  if (paused) {
    pausedOverrides.add(type);
  } else {
    pausedOverrides.delete(type);
  }
}

export function isOverridePaused(type: string): boolean {
  return pausedOverrides.has(type);
}
