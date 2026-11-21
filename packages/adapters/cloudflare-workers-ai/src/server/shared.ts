import { asNumber, asString, parseObject } from "@paperclipai/adapter-utils/portable";

export interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

export interface CloudflareWorkersAiCredentials {
  accountId: string | null;
  apiToken: string | null;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function summarizeError(payload: unknown): string | null {
  if (typeof payload === "string") return payload.trim() || null;
  const record = asRecord(payload);
  if (!record) return null;

  if (Array.isArray(record.errors) && record.errors.length > 0) {
    const first = asRecord(record.errors[0]);
    const message =
      nonEmpty(first?.message) ??
      nonEmpty(first?.code) ??
      nonEmpty(record.error) ??
      nonEmpty(record.message);
    if (message) return message;
  }

  return nonEmpty(record.error) ?? nonEmpty(record.message);
}

export function firstNonEmptyLine(value: string): string {
  return (
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

export function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function resolveCloudflareWorkersAiEnv(input: unknown): Record<string, string> {
  const parsed = parseObject(input);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

export function resolveCredentials(
  config: Record<string, unknown>,
  runtimeEnv: Record<string, string>,
): CloudflareWorkersAiCredentials {
  const accountId =
    nonEmpty(config.accountId) ??
    nonEmpty(runtimeEnv.CLOUDFLARE_ACCOUNT_ID) ??
    nonEmpty(runtimeEnv.CIUTATIS_CLOUDFLARE_ACCOUNT_ID);
  const apiToken =
    nonEmpty(config.apiToken) ??
    nonEmpty(config.token) ??
    nonEmpty(runtimeEnv.CLOUDFLARE_API_TOKEN) ??
    nonEmpty(runtimeEnv.CIUTATIS_CLOUDFLARE_API_TOKEN);
  return { accountId, apiToken };
}

export function buildRunUrl(accountId: string, model: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`;
}

export function normalizeEffort(value: unknown): "low" | "medium" | "high" | null {
  const effort = asString(value, "").trim().toLowerCase();
  if (!effort) return null;
  if (effort === "minimal") return "low";
  if (effort === "max") return "high";
  if (effort === "low" || effort === "medium" || effort === "high") return effort;
  return null;
}

export function extractResponseText(payload: unknown): string {
  const record = asRecord(payload);
  if (!record) return "";

  const result = asRecord(record.result) ?? record;
  const topLevelText = nonEmpty(result.output_text) ?? nonEmpty(result.response);
  if (topLevelText) return topLevelText;

  const firstChoice = Array.isArray(result.choices) ? asRecord(result.choices[0]) : null;
  const message = asRecord(firstChoice?.message);
  const messageText =
    nonEmpty(message?.content) ??
    nonEmpty(message?.output_text) ??
    nonEmpty(message?.text);
  if (messageText) return messageText;

  const output = Array.isArray(result.output) ? result.output : [];
  const parts: string[] = [];

  for (const item of output) {
    const message = asRecord(item);
    if (!message) continue;

    const directText =
      nonEmpty(message.text) ??
      nonEmpty(asRecord(message.text)?.value) ??
      nonEmpty(message.content);
    if (directText) parts.push(directText);

    const content = Array.isArray(message.content) ? message.content : [];
    for (const entry of content) {
      const contentRecord = asRecord(entry);
      if (!contentRecord) continue;
      const text =
        nonEmpty(contentRecord.text) ??
        nonEmpty(asRecord(contentRecord.text)?.value) ??
        nonEmpty(contentRecord.content);
      if (text) parts.push(text);
    }
  }

  return parts.join("\n\n").trim();
}

export function extractUsage(payload: unknown): UsageSummary | undefined {
  const record = asRecord(payload);
  const usage = asRecord(asRecord(record?.result)?.usage) ?? asRecord(record?.usage);
  if (!usage) return undefined;

  const inputTokens = asNumber(
    usage.input_tokens,
    asNumber(usage.prompt_tokens, asNumber(usage.inputTokens, 0)),
  );
  const outputTokens = asNumber(
    usage.output_tokens,
    asNumber(usage.completion_tokens, asNumber(usage.outputTokens, 0)),
  );
  const inputDetails = asRecord(usage.input_tokens_details) ?? asRecord(usage.inputTokensDetails);
  const cachedInputTokens = asNumber(
    inputDetails?.cached_tokens ?? asRecord(usage.prompt_tokens_details)?.cached_tokens,
    asNumber(inputDetails?.cachedTokens, 0),
  );

  if (inputTokens === 0 && outputTokens === 0 && cachedInputTokens === 0) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens,
    ...(cachedInputTokens > 0 ? { cachedInputTokens } : {}),
  };
}
