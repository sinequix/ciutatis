import { describe, expect, it } from "vitest";
import { getUIAdapter } from "./registry";

describe("UI adapter registry", () => {
  it("returns the concrete adapter module for local agent types", () => {
    expect(getUIAdapter("claude_local").type).toBe("claude_local");
    expect(getUIAdapter("codex_local").type).toBe("codex_local");
    expect(getUIAdapter("cursor").type).toBe("cursor");
    expect(getUIAdapter("openclaw_gateway").type).toBe("openclaw_gateway");
    expect(getUIAdapter("opencode_local").type).toBe("opencode_local");
    expect(getUIAdapter("pi_local").type).toBe("pi_local");
  });
});
