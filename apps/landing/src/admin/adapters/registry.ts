import type { TranscriptEntry, UIAdapterModule } from "./types";
import { claudeLocalUIAdapter } from "./claude-local";
import { cloudflareWorkersAiUIAdapter } from "./cloudflare-workers-ai";
import { codexLocalUIAdapter } from "./codex-local";
import { cursorLocalUIAdapter } from "./cursor";
import { geminiLocalUIAdapter } from "./gemini-local";
import { openClawGatewayUIAdapter } from "./openclaw-gateway";
import { openCodeLocalUIAdapter } from "./opencode-local";
import { piLocalUIAdapter } from "./pi-local";
import { processUIAdapter } from "./process";
import { httpUIAdapter } from "./http";

const adaptersByType = new Map<string, UIAdapterModule>(
  [
    claudeLocalUIAdapter,
    cloudflareWorkersAiUIAdapter,
    codexLocalUIAdapter,
    cursorLocalUIAdapter,
    geminiLocalUIAdapter,
    openClawGatewayUIAdapter,
    openCodeLocalUIAdapter,
    piLocalUIAdapter,
    processUIAdapter,
    httpUIAdapter,
  ].map((a) => [a.type, a]),
);

function buildUnsupportedUiAdapter(type: string): UIAdapterModule {
  return {
    type,
    label: `Unsupported (${type})`,
    parseStdoutLine(line: string, ts: string): TranscriptEntry[] {
      return [{ kind: "system", ts, text: line }];
    },
    ConfigFields: () => null,
    buildAdapterConfig: () => ({}),
  };
}

export function getUIAdapter(type: string): UIAdapterModule {
  return adaptersByType.get(type) ?? buildUnsupportedUiAdapter(type);
}
