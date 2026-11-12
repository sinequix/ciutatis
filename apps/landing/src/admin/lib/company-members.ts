import type { InlineEntityOption } from "@/components/InlineEntitySelector";

type CompanyUserDirectoryEntry = {
  id: string;
  name?: string | null;
  email?: string | null;
};

export function buildCompanyUserInlineOptions(
  users: readonly CompanyUserDirectoryEntry[] | { users?: readonly CompanyUserDirectoryEntry[] } | null | undefined,
  options: { excludeUserIds?: Array<string | null | undefined> } = {},
): InlineEntityOption[] {
  const entries: readonly CompanyUserDirectoryEntry[] = Array.isArray(users)
    ? users as readonly CompanyUserDirectoryEntry[]
    : users && typeof users === "object"
      ? (users as { users?: readonly CompanyUserDirectoryEntry[] }).users ?? []
      : [];
  const excluded = new Set((options.excludeUserIds ?? []).filter((id): id is string => Boolean(id)));
  return entries.map((user) => ({
    id: `user:${user.id}`,
    label: user.name || user.email || user.id,
    searchText: [user.name, user.email, user.id].filter(Boolean).join(" "),
  })).filter((option) => !excluded.has(option.id.slice("user:".length)));
}
