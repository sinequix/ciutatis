export function buildNewAgentRuntimeConfig(input: {
  heartbeatEnabled: boolean;
  intervalSec: number;
  cheapModel?: string | null;
  cheapModelEnabled?: boolean;
}) {
  return {
    heartbeatEnabled: input.heartbeatEnabled,
    intervalSec: input.intervalSec,
    cheapModel: input.cheapModel ?? null,
    cheapModelEnabled: input.cheapModelEnabled === true,
  };
}
