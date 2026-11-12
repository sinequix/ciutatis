export const DEFAULT_INSTANCE_SETTINGS_PATH = "/instance/settings/heartbeats";

export function normalizeRememberedInstanceSettingsPath(rawPath: string | null): string {
  if (!rawPath) return DEFAULT_INSTANCE_SETTINGS_PATH;

  const { pathname, search, hash } = normalizePathForMatching(rawPath);
  const suffix = instanceSettingsSuffix(pathname);
  if (!suffix) return DEFAULT_INSTANCE_SETTINGS_PATH;

  if (
    pathname === "/instance/settings/heartbeats" ||
    pathname === "/instance/settings/plugins" ||
    pathname === "/instance/settings/experimental"
  ) {
    return `${INSTANCE_SETTINGS_PATH_PREFIX}${suffix}${search}${hash}`;
  }

  if (/^\/plugins\/[^/?#]+$/.test(suffix)) {
    return `${INSTANCE_SETTINGS_PATH_PREFIX}${suffix}${search}${hash}`;
  }

  return DEFAULT_INSTANCE_SETTINGS_PATH;
}
