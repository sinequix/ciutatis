const SENSITIVE_ENV_KEY = /(key|token|secret|password|passwd|authorization|cookie)/i;
const REDACTED_LOG_VALUE = "***REDACTED***";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseObject(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function resolvePathValue(obj: Record<string, unknown>, dottedPath: string) {
  const parts = dottedPath.split(".");
  let cursor: unknown = obj;

  for (const part of parts) {
    if (!isRecord(cursor)) return "";
    cursor = cursor[part];
  }

  if (cursor === null || cursor === undefined) return "";
  if (typeof cursor === "string") return cursor;
  if (typeof cursor === "number" || typeof cursor === "boolean") return String(cursor);

  try {
    return JSON.stringify(cursor);
  } catch {
    return "";
  }
}

export function renderTemplate(template: string, data: Record<string, unknown>) {
  return template.replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_, path: string) => resolvePathValue(data, path));
}

export function joinPromptSections(
  sections: Array<string | null | undefined>,
  separator = "\n\n",
) {
  return sections
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value): value is string => value.length > 0)
    .join(separator);
}

export function redactEnvForLogs(env: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    redacted[key] = SENSITIVE_ENV_KEY.test(key) ? REDACTED_LOG_VALUE : value;
  }
  return redacted;
}

function resolveHostForUrl(rawHost: string): string {
  const host = rawHost.trim();
  if (!host || host === "0.0.0.0" || host === "::") return "localhost";
  if (host.includes(":") && !host.startsWith("[") && !host.endsWith("]")) return `[${host}]`;
  return host;
}

export function buildPaperclipEnv(
  agent: { id: string; companyId: string },
  env: Record<string, string | undefined> = {},
): Record<string, string> {
  const runtimeHost = resolveHostForUrl(env.PAPERCLIP_LISTEN_HOST ?? env.HOST ?? "localhost");
  const runtimePort = env.PAPERCLIP_LISTEN_PORT ?? env.PORT ?? "3100";
  const apiUrl =
    env.PAPERCLIP_RUNTIME_API_URL ??
    env.PAPERCLIP_API_URL ??
    `http://${runtimeHost}:${runtimePort}`;
  return {
    PAPERCLIP_AGENT_ID: agent.id,
    PAPERCLIP_COMPANY_ID: agent.companyId,
    PAPERCLIP_API_URL: apiUrl,
  };
}
