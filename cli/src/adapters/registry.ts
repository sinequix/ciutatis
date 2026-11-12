import type { CLIAdapterModule } from "@paperclipai/adapter-utils";
import { printCloudflareWorkersAiStreamEvent } from "@ciutatis/adapter-cloudflare-workers-ai/cli";
import { printGeminiStreamEvent } from "@paperclipai/adapter-gemini-local/cli";
import { processCLIAdapter } from "./process/index.js";
import { httpCLIAdapter } from "./http/index.js";

const cloudflareWorkersAiCLIAdapter: CLIAdapterModule = {
  type: "cloudflare_workers_ai",
  formatStdoutEvent: printCloudflareWorkersAiStreamEvent,
};

const cursorCloudCLIAdapter: CLIAdapterModule = {
  type: "cursor_cloud",
  formatStdoutEvent: printCursorCloudEvent,
};

const geminiLocalCLIAdapter: CLIAdapterModule = {
  type: "gemini_local",
  formatStdoutEvent: printGeminiStreamEvent,
};

const adaptersByType = new Map<string, CLIAdapterModule>(
  [
    cloudflareWorkersAiCLIAdapter,
    geminiLocalCLIAdapter,
    processCLIAdapter,
    httpCLIAdapter,
  ].map((a) => [a.type, a]),
);

export function getCLIAdapter(type: string): CLIAdapterModule {
  return adaptersByType.get(type) ?? processCLIAdapter;
}
