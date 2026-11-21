import { buildPaperclipEnv } from "@paperclipai/adapter-utils/portable";
import { resolveCloudflareWorkersAiEnv } from "./server/shared.js";
import {
  runCloudflareWorkersAi,
  stringEnv,
  testCloudflareWorkersAi,
  type CloudflareWorkersAiEnvironmentTestContext,
  type CloudflareWorkersAiEnvironmentTestResult,
  type CloudflareWorkersAiExecutionContext,
  type CloudflareWorkersAiExecutionResult,
} from "./server/run.js";

export async function execute(
  ctx: CloudflareWorkersAiExecutionContext,
): Promise<CloudflareWorkersAiExecutionResult> {
  const adapterEnv = resolveCloudflareWorkersAiEnv(ctx.config.env);
  return runCloudflareWorkersAi({
    ctx,
    runtimeEnv: stringEnv({
      ...buildPaperclipEnv(ctx.agent, adapterEnv),
      ...adapterEnv,
    }),
    readInstructions: async () => null,
  });
}

export async function testEnvironment(
  ctx: CloudflareWorkersAiEnvironmentTestContext,
): Promise<CloudflareWorkersAiEnvironmentTestResult> {
  const config = { ...(ctx.config ?? {}) };
  return testCloudflareWorkersAi(ctx, resolveCloudflareWorkersAiEnv(config.env));
}
