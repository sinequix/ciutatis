import { resolveCloudflareWorkersAiEnv } from "./shared.js";
import {
  stringEnv,
  testCloudflareWorkersAi,
  type CloudflareWorkersAiEnvironmentTestContext,
  type CloudflareWorkersAiEnvironmentTestResult,
} from "./run.js";

export async function testEnvironment(
  ctx: CloudflareWorkersAiEnvironmentTestContext,
): Promise<CloudflareWorkersAiEnvironmentTestResult> {
  const config = { ...(ctx.config ?? {}) };
  return testCloudflareWorkersAi(
    ctx,
    stringEnv({
      ...process.env,
      ...resolveCloudflareWorkersAiEnv(config.env),
    }),
  );
}
