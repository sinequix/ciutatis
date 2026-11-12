export const queryKeys = {
  companies: {
    all: ["companies"] as const,
    detail: (id: string) => ["companies", id] as const,
    stats: ["companies", "stats"] as const,
  },
  agents: {
    list: (companyId: string) => ["agents", companyId] as const,
    detail: (id: string) => ["agents", "detail", id] as const,
    runtimeState: (id: string) => ["agents", "runtime-state", id] as const,
    taskSessions: (id: string) => ["agents", "task-sessions", id] as const,
    keys: (agentId: string) => ["agents", "keys", agentId] as const,
    configRevisions: (agentId: string) => ["agents", "config-revisions", agentId] as const,
    adapters: (companyId: string) => ["agents", companyId, "adapters"] as const,
    adapterModels: (companyId: string, adapterType: string) =>
      ["agents", companyId, "adapter-models", adapterType] as const,
  },
  builtInAgents: {
    list: (companyId: string) => ["built-in-agents", companyId] as const,
  },
  issues: {
    list: (companyId: string) => ["issues", companyId] as const,
    search: (companyId: string, q: string, projectId?: string) =>
      ["issues", companyId, "search", q, projectId ?? "__all-projects__"] as const,
    listAssignedToMe: (companyId: string) => ["issues", companyId, "assigned-to-me"] as const,
    listTouchedByMe: (companyId: string) => ["issues", companyId, "touched-by-me"] as const,
    listUnreadTouchedByMe: (companyId: string) => ["issues", companyId, "unread-touched-by-me"] as const,
    listBlockedAttention: (companyId: string) => ["issues", companyId, "blocked-attention"] as const,
    countBlockedAttention: (companyId: string) => ["issues", companyId, "blocked-attention", "count"] as const,
    labels: (companyId: string) => ["issues", companyId, "labels"] as const,
    listByProject: (companyId: string, projectId: string) =>
      ["issues", companyId, "project", projectId] as const,
    detail: (id: string) => ["issues", "detail", id] as const,
    comments: (issueId: string) => ["issues", "comments", issueId] as const,
    attachments: (issueId: string) => ["issues", "attachments", issueId] as const,
    attachmentPreview: (attachmentId: string) => ["issues", "attachment-preview", attachmentId] as const,
    documents: (issueId: string) => ["issues", "documents", issueId] as const,
    documentRevisions: (issueId: string, key: string) => ["issues", "document-revisions", issueId, key] as const,
    documentAnnotations: (issueId: string, key: string, status: "open" | "resolved" | "all" = "all") =>
      ["issues", "document-annotations", issueId, key, status] as const,
    activity: (issueId: string) => ["issues", "activity", issueId] as const,
    runs: (issueId: string) => ["issues", "runs", issueId] as const,
    approvals: (issueId: string) => ["issues", "approvals", issueId] as const,
    liveRuns: (issueId: string) => ["issues", "live-runs", issueId] as const,
    activeRun: (issueId: string) => ["issues", "active-run", issueId] as const,
    workProducts: (issueId: string) => ["issues", "work-products", issueId] as const,
    listPluginOperationsByProject: (companyId: string, projectId: string, pluginId?: string | null) =>
      ["issues", companyId, "plugin-operations", projectId, pluginId ?? "__all-plugins__"] as const,
  },
  executionWorkspaces: {
    list: (companyId: string, filters?: Record<string, string | boolean | undefined>) =>
      ["execution-workspaces", companyId, filters ?? {}] as const,
    detail: (id: string) => ["execution-workspaces", "detail", id] as const,
  },
  projects: {
    list: (companyId: string) => ["projects", companyId] as const,
    detail: (id: string) => ["projects", "detail", id] as const,
  },
  cases: {
    list: (companyId: string) => ["cases", companyId] as const,
    detail: (id: string) => ["cases", "detail", id] as const,
    documents: (id: string) => ["cases", "documents", id] as const,
    documentAnnotations: (caseId: string, key: string, status: "open" | "resolved" | "all" = "all") =>
      ["cases", "document-annotations", caseId, key, status] as const,
    events: (id: string) => ["cases", "events", id] as const,
    children: (parentId: string) => ["cases", "children", parentId] as const,
    revisions: (id: string, key: string) => ["cases", "revisions", id, key] as const,
    forIssue: (issueId: string) => ["cases", "for-issue", issueId] as const,
  },
  externalObjects: {
    byIssue: (issueId: string) => ["external-objects", "by-issue", issueId] as const,
    issueSummary: (issueId: string) => ["external-objects", "issue-summary", issueId] as const,
    issueSummaries: (companyId: string, issueIds: readonly string[]) =>
      ["external-objects", "issue-summaries", companyId, issueIds] as const,
    projectSummary: (projectId: string) => ["external-objects", "project-summary", projectId] as const,
  },
  goals: {
    list: (companyId: string) => ["goals", companyId] as const,
    detail: (id: string) => ["goals", "detail", id] as const,
  },
  routines: {
    list: (companyId: string) => ["routines", companyId] as const,
    detail: (routineId: string) => ["routines", "detail", routineId] as const,
    revisions: (routineId: string) => ["routines", "revisions", routineId] as const,
    runs: (routineId: string) => ["routines", "runs", routineId] as const,
    activity: (companyId: string, routineId: string) => ["routines", companyId, routineId, "activity"] as const,
  },
  budgets: {
    overview: (companyId: string) => ["budgets", "overview", companyId] as const,
  },
  approvals: {
    list: (companyId: string, status?: string) =>
      ["approvals", companyId, status] as const,
    detail: (approvalId: string) => ["approvals", "detail", approvalId] as const,
    comments: (approvalId: string) => ["approvals", "comments", approvalId] as const,
    issues: (approvalId: string) => ["approvals", "issues", approvalId] as const,
  },
  access: {
    joinRequests: (companyId: string, status: string = "pending_approval") =>
      ["access", "join-requests", companyId, status] as const,
    invite: (token: string) => ["access", "invite", token] as const,
    companyUserDirectory: (companyId: string) => ["access", "company-user-directory", companyId] as const,
  },
  auth: {
    session: ["auth", "session"] as const,
  },
  publicPortal: {
    institutions: ["public-portal", "institutions"] as const,
    institution: (slug: string) => ["public-portal", "institution", slug] as const,
    requests: (filters?: Record<string, string | undefined>) => ["public-portal", "requests", filters ?? {}] as const,
    detail: (publicId: string) => ["public-portal", "detail", publicId] as const,
  },
  resourceMemberships: {
    mine: (companyId: string) => ["resource-memberships", companyId, "me"] as const,
  },
  instance: {
    adminOverview: ["instance", "admin-overview"] as const,
    schedulerHeartbeats: ["instance", "scheduler-heartbeats"] as const,
    experimentalSettings: ["instance", "experimental-settings"] as const,
    tenantProvisioning: ["instance", "tenant-provisioning"] as const,
    cloudflareProvisioning: ["instance", "cloudflare-provisioning"] as const,
    tenants: ["instance", "tenants"] as const,
    tenantJobs: (tenantId: string) => ["instance", "tenant-jobs", tenantId] as const,
  },
  cloudUpstreams: (companyId: string) => ["cloud-upstreams", companyId] as const,
  health: ["health"] as const,
  companySearch: {
    search: (
      companyId: string,
      query: string,
      scope: string,
      limit: number,
      offset: number,
    ) => ["company-search", companyId, query, scope, limit, offset] as const,
  },
  environments: {
    list: (companyId: string) => ["environments", companyId] as const,
    capabilities: (companyId: string) => ["environments", companyId, "capabilities"] as const,
  },
  secrets: {
    list: (companyId: string) => ["secrets", companyId] as const,
    providers: (companyId: string) => ["secret-providers", companyId] as const,
    providerConfigs: (companyId: string) => ["secret-provider-configs", companyId] as const,
    usage: (secretId: string) => ["secrets", "usage", secretId] as const,
    accessEvents: (secretId: string) => ["secrets", "access-events", secretId] as const,
    userDefinitions: (companyId: string) => ["user-secret-definitions", companyId] as const,
    userDefinitionCoverage: (companyId: string, definitionId: string) =>
      ["user-secret-definitions", companyId, definitionId, "coverage"] as const,
    myUserSecrets: (companyId: string) => ["my-user-secrets", companyId] as const,
  },
  dashboard: (companyId: string) => ["dashboard", companyId] as const,
  sidebarBadges: (companyId: string) => ["sidebar-badges", companyId] as const,
  activity: (companyId: string) => ["activity", companyId] as const,
  costs: (companyId: string, from?: string, to?: string) =>
    ["costs", companyId, from, to] as const,
  usageByProvider: (companyId: string, from?: string, to?: string) =>
    ["usage-by-provider", companyId, from, to] as const,
  usageByBiller: (companyId: string, from?: string, to?: string) =>
    ["usage-by-biller", companyId, from, to] as const,
  financeSummary: (companyId: string, from?: string, to?: string) =>
    ["finance-summary", companyId, from, to] as const,
  financeByBiller: (companyId: string, from?: string, to?: string) =>
    ["finance-by-biller", companyId, from, to] as const,
  financeByKind: (companyId: string, from?: string, to?: string) =>
    ["finance-by-kind", companyId, from, to] as const,
  financeEvents: (companyId: string, from?: string, to?: string, limit: number = 100) =>
    ["finance-events", companyId, from, to, limit] as const,
  usageWindowSpend: (companyId: string) =>
    ["usage-window-spend", companyId] as const,
  usageQuotaWindows: (companyId: string) =>
    ["usage-quota-windows", companyId] as const,
  heartbeats: (companyId: string, agentId?: string) =>
    ["heartbeats", companyId, agentId] as const,
  runDetail: (runId: string) => ["heartbeat-run", runId] as const,
  runWorkspaceOperations: (runId: string) => ["heartbeat-run", runId, "workspace-operations"] as const,
  liveRuns: (companyId: string) => ["live-runs", companyId] as const,
  runIssues: (runId: string) => ["run-issues", runId] as const,
  org: (companyId: string) => ["org", companyId] as const,
  userProfile: (companyId: string, userSlug: string) => ["user-profile", companyId, userSlug] as const,
  skills: {
    available: ["skills", "available"] as const,
  },
  plugins: {
    all: ["plugins"] as const,
    examples: ["plugins", "examples"] as const,
    detail: (pluginId: string) => ["plugins", pluginId] as const,
    health: (pluginId: string) => ["plugins", pluginId, "health"] as const,
    uiContributions: ["plugins", "ui-contributions"] as const,
    config: (pluginId: string) => ["plugins", pluginId, "config"] as const,
    dashboard: (pluginId: string) => ["plugins", pluginId, "dashboard"] as const,
    logs: (pluginId: string) => ["plugins", pluginId, "logs"] as const,
    localFolders: (pluginId: string, companyId: string) =>
      ["plugins", pluginId, "local-folders", companyId] as const,
  },
};
