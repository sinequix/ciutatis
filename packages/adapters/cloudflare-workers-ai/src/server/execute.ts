import fs from "node:fs/promises";
import { resolveCloudflareWorkersAiEnv } from "./shared.js";
import {
  mergeRuntimeEnv,
  runCloudflareWorkersAi,
  type CloudflareWorkersAiExecutionContext,
  type CloudflareWorkersAiExecutionResult,
} from "./run.js";

export async function execute(
  ctx: CloudflareWorkersAiExecutionContext,
): Promise<CloudflareWorkersAiExecutionResult> {
  const runtimeEnv = mergeRuntimeEnv(
    process.env,
    resolveCloudflareWorkersAiEnv(ctx.config.env),
    ctx.agent,
  );
  return runCloudflareWorkersAi({
    ctx,
    runtimeEnv,
    readInstructions: (filePath) => fs.readFile(filePath, "utf8"),
  });
}
