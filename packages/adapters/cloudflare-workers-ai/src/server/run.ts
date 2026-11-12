import {
  asNumber,
  asString,
  buildPaperclipEnv,
  joinPromptSections,
  redactEnvForLogs,
  renderTemplate,
} from "@paperclipai/adapter-utils/portable";
import { DEFAULT_CLOUDFLARE_WORKERS_AI_MODEL } from "../index.js";
import {
  buildRunUrl,
  extractResponseText,
  extractUsage,
  firstNonEmptyLine,
  normalizeEffort,
  resolveCredentials,
  summarizeError,
  type UsageSummary,
} from "./shared.js";

export interface CloudflareWorkersAiAgent {
  id: string;
  companyId: string;
  name: string;
  adapterType: string | null;
  adapterConfig: unknown;
}

export interface CloudflareWorkersAiRuntime {
  sessionId: string | null;
  sessionParams: Record<string, unknown> | null;
  sessionDisplayId: string | null;
  taskKey: string | null;
}

export interface CloudflareWorkersAiInvocationMeta {
  adapterType: string;
  command: string;
  commandArgs?: string[];
  commandNotes?: string[];
  env?: Record<string, string>;
  prompt?: string;
  promptMetrics?: Record<string, number>;
}

export interface CloudflareWorkersAiExecutionContext {
  runId: string;
  agent: CloudflareWorkersAiAgent;
  runtime: CloudflareWorkersAiRuntime;
  config: Record<string, unknown>;
  context: Record<string, unknown>;
  onLog: (stream: "stdout" | "stderr", chunk: string) => Promise<void>;
  onMeta?: (meta: CloudflareWorkersAiInvocationMeta) => Promise<void>;
}

export interface CloudflareWorkersAiExecutionResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  errorMessage?: string | null;
  errorCode?: string | null;
  usage?: UsageSummary;
  provider?: string | null;
  biller?: string | null;
  model?: string | null;
  billingType?: "metered_api" | null;
  summary?: string | null;
  resultJson?: Record<string, unknown> | null;
}

export interface CloudflareWorkersAiEnvironmentCheck {
  code: string;
  level: "info" | "warn" | "error";
  message: string;
  hint?: string | null;
}

export interface CloudflareWorkersAiEnvironmentTestContext {
  companyId: string;
  adapterType: string;
  config: Record<string, unknown>;
}

export interface CloudflareWorkersAiEnvironmentTestResult {
  adapterType: string;
  status: "pass" | "warn" | "fail";
  checks: CloudflareWorkersAiEnvironmentCheck[];
  testedAt: string;
}

function buildInstructionsPrefix(instructionsFilePath: string, instructionsContents: string): string {
  if (!instructionsContents.trim()) return "";
  return [
    instructionsContents.trim(),
    "",
    `The above agent instructions were loaded from ${instructionsFilePath}.`,
  ].join("\n");
}

function summarizeStatus(
  checks: CloudflareWorkersAiEnvironmentCheck[],
): CloudflareWorkersAiEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

export async function runCloudflareWorkersAi(input: {
  ctx: CloudflareWorkersAiExecutionContext;
  runtimeEnv: Record<string, string>;
  readInstructions: (filePath: string) => Promise<string | null>;
}): Promise<CloudflareWorkersAiExecutionResult> {
  const { ctx, runtimeEnv, readInstructions } = input;
  const { runId, agent, config: rawConfig, context, onLog, onMeta } = ctx;
  const config = { ...rawConfig };
  const promptTemplate = asString(
    config.promptTemplate,
    "You are agent {{agent.id}} ({{agent.name}}). Continue your Ciutatis work and be explicit about blockers or next steps.",
  );
  const model = asString(config.model, DEFAULT_CLOUDFLARE_WORKERS_AI_MODEL).trim();
  const timeoutSec = asNumber(config.timeoutSec, 120);
  const maxOutputTokens = Math.max(64, asNumber(config.maxOutputTokens, 4096));
  const credentials = resolveCredentials(config, runtimeEnv);
  if (!credentials.accountId || !credentials.apiToken) {
    const missing = [
      credentials.accountId ? null : "CLOUDFLARE_ACCOUNT_ID",
      credentials.apiToken ? null : "CLOUDFLARE_API_TOKEN",
    ]
      .filter((item): item is string => item !== null)
      .join(", ");
    await onLog(
      "stderr",
      JSON.stringify({
        type: "system",
        subtype: "error",
        error: `Missing Cloudflare Workers AI credentials: ${missing}`,
      }) + "\n",
    );
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorCode: "cloudflare_workers_ai_credentials_missing",
      errorMessage: `Missing Cloudflare Workers AI credentials: ${missing}`,
    };
  }

  const instructionsFilePath = asString(config.instructionsFilePath, "").trim();
  let instructionsPrefix = "";
  if (instructionsFilePath) {
    try {
      const instructionsContents = await readInstructions(instructionsFilePath);
      if (instructionsContents === null) {
        await onLog(
          "stderr",
          JSON.stringify({
            type: "system",
            subtype: "warn",
            error: `Could not read instructions file "${instructionsFilePath}": filesystem is unavailable in this runtime`,
          }) + "\n",
        );
      } else {
        instructionsPrefix = buildInstructionsPrefix(instructionsFilePath, instructionsContents);
        await onLog(
          "stdout",
          JSON.stringify({
            type: "system",
            subtype: "info",
            message: `Loaded agent instructions from ${instructionsFilePath}`,
          }) + "\n",
        );
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await onLog(
        "stderr",
        JSON.stringify({
          type: "system",
          subtype: "warn",
          error: `Could not read instructions file "${instructionsFilePath}": ${reason}`,
        }) + "\n",
      );
    }
  }

  const templateData = {
    agentId: agent.id,
    companyId: agent.companyId,
    runId,
    company: { id: agent.companyId },
    agent,
    run: { id: runId, source: "on_demand" },
    context,
  };
  const renderedPrompt = renderTemplate(promptTemplate, templateData);
  const sessionHandoffNote = asString(context.paperclipSessionHandoffMarkdown, "").trim();
  const systemPrompt = joinPromptSections([
    "You are a Ciutatis agent backed by Cloudflare Workers AI.",
    "This runtime provides hosted model inference only. Do not claim to have run shell commands, edited files, or accessed tools unless the prompt explicitly includes such outputs.",
    instructionsPrefix,
  ]);
  const userPrompt = joinPromptSections([sessionHandoffNote, renderedPrompt]);
  const effort = normalizeEffort(config.effort ?? config.reasoningEffort);

  if (onMeta) {
    await onMeta({
      adapterType: "cloudflare_workers_ai",
      command: "cloudflare-workers-ai",
      commandNotes: ["Invokes Cloudflare Workers AI via the direct ai/run REST API."],
      commandArgs: [
        `model=${model}`,
        ...(effort ? [`reasoning=${effort}`] : []),
        `max_tokens=${maxOutputTokens}`,
        `<prompt ${userPrompt.length} chars>`,
      ],
      env: redactEnvForLogs({
        CLOUDFLARE_ACCOUNT_ID: credentials.accountId,
        CLOUDFLARE_API_TOKEN: credentials.apiToken,
      }),
      prompt: userPrompt,
      promptMetrics: {
        promptChars: userPrompt.length,
        instructionsChars: systemPrompt.length,
      },
    });
  }

  const body: Record<string, unknown> = {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_tokens: maxOutputTokens,
  };
  if (effort) {
    body.reasoning = { effort };
  }

  await onLog(
    "stdout",
    JSON.stringify({ type: "system", subtype: "init", model }) + "\n",
  );

  const controller = new AbortController();
  const timeout = timeoutSec > 0 ? setTimeout(() => controller.abort(), timeoutSec * 1000) : null;

  try {
    const response = await fetch(buildRunUrl(credentials.accountId, model), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${credentials.apiToken}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const payload = await readJsonRecord(response);
    if (!response.ok) {
      const reason = summarizeError(payload) ?? `Cloudflare Workers AI returned status ${response.status}`;
      await onLog(
        "stderr",
        JSON.stringify({ type: "system", subtype: "error", error: reason }) + "\n",
      );
      return {
        exitCode: response.status,
        signal: null,
        timedOut: false,
        errorCode: "cloudflare_workers_ai_request_failed",
        errorMessage: reason,
        provider: "cloudflare",
        biller: "cloudflare",
        model,
        billingType: "metered_api",
        resultJson: payload,
      };
    }

    const outputText = extractResponseText(payload);
    const usage = extractUsage(payload);
    if (outputText) {
      await onLog(
        "stdout",
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "output_text", text: outputText }],
          },
        }) + "\n",
      );
    }
    await onLog(
      "stdout",
      JSON.stringify({
        type: "result",
        subtype: "success",
        usage: {
          input_tokens: usage?.inputTokens ?? 0,
          output_tokens: usage?.outputTokens ?? 0,
          cached_input_tokens: usage?.cachedInputTokens ?? 0,
        },
      }) + "\n",
    );

    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      usage,
      provider: "cloudflare",
      biller: "cloudflare",
      model,
      billingType: "metered_api",
      summary: firstNonEmptyLine(outputText),
      resultJson: payload,
    };
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    const message = isAbort
      ? `Cloudflare Workers AI request timed out after ${timeoutSec}s`
      : error instanceof Error
        ? error.message
        : String(error);
    await onLog(
      "stderr",
      JSON.stringify({ type: "system", subtype: "error", error: message }) + "\n",
    );
    return {
      exitCode: null,
      signal: null,
      timedOut: isAbort,
      errorCode: isAbort ? "cloudflare_workers_ai_timeout" : "cloudflare_workers_ai_request_error",
      errorMessage: message,
      provider: "cloudflare",
      biller: "cloudflare",
      model,
      billingType: "metered_api",
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function testCloudflareWorkersAi(
  ctx: CloudflareWorkersAiEnvironmentTestContext,
  runtimeEnv: Record<string, string>,
): Promise<CloudflareWorkersAiEnvironmentTestResult> {
  const config = { ...(ctx.config ?? {}) };
  const credentials = resolveCredentials(config, runtimeEnv);
  const checks: CloudflareWorkersAiEnvironmentCheck[] = [];

  if (!credentials.accountId) {
    checks.push({
      code: "cloudflare_workers_ai_account_missing",
      level: "error",
      message: "Cloudflare account ID is not configured.",
      hint: "Set CLOUDFLARE_ACCOUNT_ID or CIUTATIS_CLOUDFLARE_ACCOUNT_ID on the server.",
    });
  } else {
    checks.push({
      code: "cloudflare_workers_ai_account_present",
      level: "info",
      message: `Configured account: ${credentials.accountId}`,
    });
  }

  if (!credentials.apiToken) {
    checks.push({
      code: "cloudflare_workers_ai_token_missing",
      level: "error",
      message: "Cloudflare API token is not configured.",
      hint: "Set CLOUDFLARE_API_TOKEN or CIUTATIS_CLOUDFLARE_API_TOKEN on the server.",
    });
  } else {
    checks.push({
      code: "cloudflare_workers_ai_token_present",
      level: "info",
      message: "Cloudflare API token detected.",
    });
  }

  const model = asString(config.model, DEFAULT_CLOUDFLARE_WORKERS_AI_MODEL).trim();
  checks.push({
    code: "cloudflare_workers_ai_model_configured",
    level: "info",
    message: `Configured model: ${model}`,
  });

  const effort = normalizeEffort(config.effort ?? config.reasoningEffort);
  if (effort) {
    checks.push({
      code: "cloudflare_workers_ai_reasoning_effort",
      level: "info",
      message: `Reasoning effort: ${effort}`,
    });
  }

  if (!credentials.accountId || !credentials.apiToken) {
    return {
      adapterType: ctx.adapterType,
      status: summarizeStatus(checks),
      checks,
      testedAt: new Date().toISOString(),
    };
  }

  try {
    const response = await fetch(buildRunUrl(credentials.accountId, model), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${credentials.apiToken}`,
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Respond with hello." }],
        max_tokens: 32,
        ...(effort ? { reasoning: { effort } } : {}),
      }),
    });
    const payload = await readJsonRecord(response);
    if (!response.ok) {
      checks.push({
        code: "cloudflare_workers_ai_probe_failed",
        level: "error",
        message: summarizeError(payload) ?? `Workers AI probe failed with status ${response.status}.`,
        hint: "Verify the account ID, API token permissions, and model availability.",
      });
    } else {
      const text = extractResponseText(payload);
      checks.push({
        code: "cloudflare_workers_ai_probe_ok",
        level: text ? "info" : "warn",
        message: text
          ? `Workers AI probe succeeded: ${text}`
          : "Workers AI probe succeeded but returned no text.",
      });
    }
  } catch (error) {
    checks.push({
      code: "cloudflare_workers_ai_probe_error",
      level: "error",
      message: error instanceof Error ? error.message : "Workers AI probe failed.",
      hint: "Check outbound network access to api.cloudflare.com from the Ciutatis server host.",
    });
  }

  return {
    adapterType: ctx.adapterType,
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}

export function mergeRuntimeEnv(
  base: Record<string, string | undefined>,
  adapterEnv: Record<string, string>,
  agent: { id: string; companyId: string },
): Record<string, string> {
  return Object.fromEntries(
    Object.entries({
      ...base,
      ...buildPaperclipEnv(agent, base),
      ...adapterEnv,
    }).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

export function stringEnv(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonRecord(response: Response): Promise<Record<string, unknown> | null> {
  const payload: unknown = await response.json().catch(() => null);
  return isRecord(payload) ? payload : null;
}
