import type { AdapterConfigSchema, ConfigFieldSchema } from "@paperclipai/adapter-utils";

function readVisibleWhen(field: ConfigFieldSchema): Record<string, unknown> | null {
  const meta = field.meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const visibleWhen = (meta as Record<string, unknown>).visibleWhen;
  if (!visibleWhen || typeof visibleWhen !== "object" || Array.isArray(visibleWhen)) return null;
  return visibleWhen as Record<string, unknown>;
}

export function fieldMatchesVisibleWhen(
  field: ConfigFieldSchema,
  getValue: (key: string) => unknown,
  _schema: AdapterConfigSchema,
) {
  const visibleWhen = readVisibleWhen(field);
  if (!visibleWhen) return true;
  const key = typeof visibleWhen.key === "string" ? visibleWhen.key : null;
  const values = Array.isArray(visibleWhen.values)
    ? visibleWhen.values.filter((value): value is string => typeof value === "string")
    : [];
  if (!key || values.length === 0) return false;
  return values.includes(String(getValue(key)));
}

export {
  buildSchemaAdapterConfig,
  invalidateConfigSchemaCache,
  SchemaConfigFields,
} from "./schema-config-panel";
