import { Navigate, Outlet, Route, Routes, useLocation, useParams } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Layout } from "./components/Layout";
import { OnboardingWizard } from "./components/OnboardingWizard";
import { authApi } from "./api/auth";
import { healthApi } from "./api/health";
import { Dashboard } from "./pages/Dashboard";
import { Institutions } from "./pages/Institutions";
import { Agents } from "./pages/Agents";
import { AgentDetail } from "./pages/AgentDetail";
import { Projects } from "./pages/Projects";
import { ProjectDetail } from "./pages/ProjectDetail";
import { Requests } from "./pages/Requests";
import { RequestDetail } from "./pages/RequestDetail";
import { ExecutionWorkspaceDetail } from "./pages/ExecutionWorkspaceDetail";
import { Search } from "./pages/Search";
import { Workspaces } from "./pages/Workspaces";
import { Objectives } from "./pages/Objectives";
import { ObjectiveDetail } from "./pages/ObjectiveDetail";
import { Approvals } from "./pages/Approvals";
import { ApprovalDetail } from "./pages/ApprovalDetail";
import { Costs } from "./pages/Costs";
import { Activity } from "./pages/Activity";
import { Inbox } from "./pages/Inbox";
import { InstitutionSettings } from "./pages/InstitutionSettings";
import { CompanyEnvironments } from "./pages/CompanyEnvironments";
import { UserProfile } from "./pages/UserProfile";
import { DesignGuide } from "./pages/DesignGuide";
import { InstanceSettings } from "./pages/InstanceSettings";
import { InstanceAdminOverview } from "./pages/InstanceAdminOverview";
import { InstanceTenants } from "./pages/InstanceTenants";
import { InstanceCloudflareSettings } from "./pages/InstanceCloudflareSettings";
import { InstanceExperimentalSettings } from "./pages/InstanceExperimentalSettings";
import { PluginManager } from "./pages/PluginManager";
import { PluginSettings } from "./pages/PluginSettings";
import { PluginPage } from "./pages/PluginPage";
import { RunTranscriptUxLab } from "./pages/RunTranscriptUxLab";
import { OrgChart } from "./pages/OrgChart";
import { NewAgent } from "./pages/NewAgent";
import { AuthPage } from "./pages/Auth";
import { CouncilClaimPage } from "./pages/CouncilClaim";
import { InviteLandingPage } from "./pages/InviteLanding";
import { NotFoundPage } from "./pages/NotFound";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { PublicSite } from "./pages/PublicSite";
import { PublicPortalPage } from "./pages/PublicPortalPage";
import { PublicPortalRequestPage } from "./pages/PublicPortalRequestPage";
import { GovOpsPage } from "./pages/GovOpsPage";
import { ScrutinyPage } from "./pages/ScrutinyPage";
import { queryKeys } from "./lib/queryKeys";
import { isAdminHostname, isPublicSitePath } from "./lib/public-site-paths";
import { useCompany, useOptionalCompany } from "./context/CompanyContext";
import { useDialog } from "./context/DialogContext";
import { loadLastInboxTab } from "./lib/inbox";
import { shouldRedirectCompanylessRouteToOnboarding } from "./lib/onboarding-route";

function RootPage() {
  const healthQuery = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => healthApi.get(),
    retry: false,
  });

  const isAuthenticatedMode = healthQuery.data?.deploymentMode === "authenticated";

  const sessionQuery = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    enabled: isAuthenticatedMode,
    retry: false,
  });

  if (healthQuery.isLoading || (isAuthenticatedMode && sessionQuery.isLoading)) {
    return <div className="mx-auto max-w-xl py-10 text-sm text-muted-foreground">Loading...</div>;
  }

  if (healthQuery.error) {
    return (
      <div className="mx-auto max-w-xl py-10 text-sm text-destructive">
        {healthQuery.error instanceof Error ? healthQuery.error.message : "Failed to load app state"}
      </div>
    );
  }

  if (isAuthenticatedMode && healthQuery.data?.bootstrapStatus === "bootstrap_pending") {
    return <BootstrapPendingPage hasActiveInvite={healthQuery.data.bootstrapInviteActive} />;
  }

  if (isAuthenticatedMode && !sessionQuery.data) {
    return <Navigate to="/auth" replace />;
  }

  return <CompanyRootRedirect />;
}

function ShellEntryRedirect() {
  return <RootPage />;
}

function BootstrapPendingPage({ hasActiveInvite = false }: { hasActiveInvite?: boolean }) {
  return (
    <div className="mx-auto max-w-xl py-10">
      <div className="rounded-lg border border-border bg-card p-6">
        <h1 className="text-xl font-semibold">Instance setup required</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {hasActiveInvite
            ? "No instance admin exists yet. A bootstrap invite is already active. Check your Ciutatis startup logs for the first admin invite URL, or run this command to rotate it:"
            : "No instance admin exists yet. Run this command in your Ciutatis environment to generate the first admin invite URL:"}
        </p>
        <pre className="mt-4 overflow-x-auto rounded-md border border-border bg-muted/30 p-3 text-xs">
{`pnpm ciutatis auth bootstrap-ceo`}
        </pre>
      </div>
    </div>
  );
}

function CloudAccessGate() {
  const healthQuery = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => healthApi.get(),
    retry: false,
    refetchInterval: (query) => {
      const data = query.state.data as
        | { deploymentMode?: "local_trusted" | "authenticated"; bootstrapStatus?: "ready" | "bootstrap_pending" }
        | undefined;
      return data?.deploymentMode === "authenticated" && data.bootstrapStatus === "bootstrap_pending"
        ? 2000
        : false;
    },
    refetchIntervalInBackground: true,
  });

  const isAuthenticatedMode = healthQuery.data?.deploymentMode === "authenticated";
  const sessionQuery = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    enabled: isAuthenticatedMode,
    retry: false,
  });

  if (healthQuery.isLoading || (isAuthenticatedMode && sessionQuery.isLoading)) {
    return <div className="mx-auto max-w-xl py-10 text-sm text-muted-foreground">Loading...</div>;
  }

  if (healthQuery.error) {
    return (
      <div className="mx-auto max-w-xl py-10 text-sm text-destructive">
        {healthQuery.error instanceof Error ? healthQuery.error.message : "Failed to load app state"}
      </div>
    );
  }

  if (isAuthenticatedMode && healthQuery.data?.bootstrapStatus === "bootstrap_pending") {
    return <BootstrapPendingPage hasActiveInvite={healthQuery.data.bootstrapInviteActive} />;
  }

  if (isAuthenticatedMode && !sessionQuery.data) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}

function councilRoutes() {
  return (
    <>
      <Route index element={<Navigate to="dashboard" replace />} />
      <Route path="dashboard" element={<Dashboard />} />
      <Route path="onboarding" element={<OnboardingRoutePage />} />
      <Route path="institutions" element={<Institutions />} />
      <Route path="institution/settings" element={<InstitutionSettings />} />
      <Route path="institution/settings/environments" element={<CompanyEnvironments />} />
      <Route path="company/settings" element={<Navigate to="/institution/settings" replace />} />
      <Route path="company/settings/environments" element={<Navigate to="/institution/settings/environments" replace />} />
      <Route path="settings" element={<LegacySettingsRedirect />} />
      <Route path="settings/*" element={<LegacySettingsRedirect />} />
      <Route path="plugins/:pluginId" element={<PluginPage />} />
      <Route path="org" element={<OrgChart />} />
      <Route path="agents" element={<Navigate to="/agents/all" replace />} />
      <Route path="agents/all" element={<Agents />} />
      <Route path="agents/active" element={<Agents />} />
      <Route path="agents/paused" element={<Agents />} />
      <Route path="agents/error" element={<Agents />} />
      <Route path="agents/new" element={<NewAgent />} />
      <Route path="agents/:agentId" element={<AgentDetail />} />
      <Route path="agents/:agentId/:tab" element={<AgentDetail />} />
      <Route path="agents/:agentId/runs/:runId" element={<AgentDetail />} />
      <Route path="projects" element={<Projects />} />
      <Route path="projects/:projectId" element={<ProjectDetail />} />
      <Route path="projects/:projectId/overview" element={<ProjectDetail />} />
      <Route path="projects/:projectId/requests" element={<ProjectDetail />} />
      <Route path="projects/:projectId/requests/:filter" element={<ProjectDetail />} />
      <Route path="projects/:projectId/issues" element={<ProjectDetail />} />
      <Route path="projects/:projectId/issues/:filter" element={<ProjectDetail />} />
      <Route path="projects/:projectId/workspaces" element={<ProjectDetail />} />
      <Route path="projects/:projectId/configuration" element={<ProjectDetail />} />
      <Route path="projects/:projectId/budget" element={<ProjectDetail />} />
      <Route path="search" element={<Search />} />
      <Route path="workspaces" element={<Workspaces />} />
      <Route path="users/:userSlug" element={<UserProfile />} />
      <Route path="requests" element={<Requests />} />
      <Route path="requests/all" element={<Navigate to="/requests" replace />} />
      <Route path="requests/active" element={<Navigate to="/requests" replace />} />
      <Route path="requests/backlog" element={<Navigate to="/requests" replace />} />
      <Route path="requests/done" element={<Navigate to="/requests" replace />} />
      <Route path="requests/recent" element={<Navigate to="/requests" replace />} />
      <Route path="requests/:issueId" element={<RequestDetail />} />
      <Route path="issues" element={<Navigate to="/requests" replace />} />
      <Route path="issues/:issueId" element={<RequestDetail />} />
      <Route path="execution-workspaces/:workspaceId" element={<ExecutionWorkspaceDetail />} />
      <Route path="objectives" element={<Objectives />} />
      <Route path="objectives/:goalId" element={<ObjectiveDetail />} />
      <Route path="approvals" element={<Navigate to="/approvals/pending" replace />} />
      <Route path="approvals/pending" element={<Approvals />} />
      <Route path="approvals/all" element={<Approvals />} />
      <Route path="approvals/:approvalId" element={<ApprovalDetail />} />
      <Route path="costs" element={<Costs />} />
      <Route path="activity" element={<Activity />} />
      <Route path="inbox" element={<InboxRootRedirect />} />
      <Route path="inbox/recent" element={<Inbox />} />
      <Route path="inbox/unread" element={<Inbox />} />
      <Route path="inbox/all" element={<Inbox />} />
      <Route path="inbox/new" element={<Navigate to="/inbox/recent" replace />} />
      <Route path="design-guide" element={<DesignGuide />} />
      <Route path="tests/ux/runs" element={<RunTranscriptUxLab />} />
      <Route path=":pluginRoutePath" element={<PluginPage />} />
      <Route path="*" element={<NotFoundPage scope="board" />} />
    </>
  );
}

function InboxRootRedirect() {
  return <Navigate to={`/inbox/${loadLastInboxTab()}`} replace />;
}

function LegacySettingsRedirect() {
  const location = useLocation();
  return <Navigate to={`/instance/settings/overview${location.search}${location.hash}`} replace />;
}

function OnboardingRoutePage() {
  const { companies } = useCompany();
  const { openOnboarding } = useDialog();
  const { companyPrefix } = useParams<{ companyPrefix?: string }>();
  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    retry: false,
  });
  const isAdmin = session?.user?.isInstanceAdmin === true;
  const matchedCompany = companyPrefix
    ? companies.find((company) => company.issuePrefix.toUpperCase() === companyPrefix.toUpperCase()) ?? null
    : null;

  const needsNewCompany = !matchedCompany;

  if (needsNewCompany && !isAdmin) {
    return (
      <div className="mx-auto max-w-xl py-10">
        <div className="rounded-lg border border-border bg-card p-6">
          <h1 className="text-xl font-semibold">Admin access required</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Please contact your administrator to set up the instance.
          </p>
        </div>
      </div>
    );
  }

  const title = matchedCompany
    ? `Add another agent to ${matchedCompany.name}`
    : companies.length > 0
      ? "Create another institution"
      : "Create your first institution";
  const description = matchedCompany
    ? "Run onboarding again to add an agent and a starter task for this institution."
    : companies.length > 0
      ? "Run onboarding again to create another institution and seed its first agent."
      : "Get started by creating an institution and your first agent.";

  return (
    <div className="mx-auto max-w-xl py-10">
      <div className="rounded-lg border border-border bg-card p-6">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        <div className="mt-4">
          <Button
            onClick={() =>
              matchedCompany
                ? openOnboarding({ initialStep: 2, companyId: matchedCompany.id })
                : openOnboarding()
            }
          >
            {matchedCompany ? "Add Agent" : "Start Onboarding"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function CompanyRootRedirect() {
  const { companies, selectedCompany, loading } = useCompany();
  const location = useLocation();

  if (loading) {
    return <div className="mx-auto max-w-xl py-10 text-sm text-muted-foreground">Loading...</div>;
  }

  const targetCompany = selectedCompany ?? companies[0] ?? null;
  if (!targetCompany) {
    if (
      shouldRedirectCompanylessRouteToOnboarding({
        pathname: location.pathname,
        hasCompanies: false,
      })
    ) {
      return <Navigate to="/onboarding" replace />;
    }
    return <NoCompaniesStartPage />;
  }

  return <Navigate to={`/${targetCompany.issuePrefix}/dashboard`} replace />;
}

function UnprefixedBoardRedirect() {
  const location = useLocation();
  const { companies, selectedCompany, loading } = useCompany();

  if (loading) {
    return <div className="mx-auto max-w-xl py-10 text-sm text-muted-foreground">Loading...</div>;
  }

  const targetCompany = selectedCompany ?? companies[0] ?? null;
  if (!targetCompany) {
    if (
      shouldRedirectCompanylessRouteToOnboarding({
        pathname: location.pathname,
        hasCompanies: false,
      })
    ) {
      return <Navigate to="/onboarding" replace />;
    }
    return <NoCompaniesStartPage />;
  }

  return (
    <Navigate
      to={`/${targetCompany.issuePrefix}${location.pathname}${location.search}${location.hash}`}
      replace
    />
  );
}

function NoCompaniesStartPage() {
  const { openOnboarding } = useDialog();
  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    retry: false,
  });
  const isAdmin = session?.user?.isInstanceAdmin === true;

  return (
    <div className="mx-auto max-w-xl py-10">
      <div className="rounded-lg border border-border bg-card p-6">
        {isAdmin ? (
          <>
            <h1 className="text-xl font-semibold">Create your first institution</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Get started by creating an institution.
            </p>
            <div className="mt-4">
              <Button onClick={() => openOnboarding()}>New Institution</Button>
            </div>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold">No institutions available</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Please contact your administrator to set up the instance.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export function App() {
  const location = useLocation();
  const companyContext = useOptionalCompany();
  const currentHostname = globalThis.location?.hostname ?? null;
  const isAdminHost = isAdminHostname(currentHostname);
  const isPublicRoute = isPublicSitePath(location.pathname, currentHostname);
  const publicEntryElement = isAdminHost ? <ShellEntryRedirect /> : <PublicSite />;

  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/" element={publicEntryElement} />
        <Route path="contact" element={publicEntryElement} />
        <Route path="platform" element={publicEntryElement} />
        <Route path="about" element={publicEntryElement} />
        <Route path="partners" element={publicEntryElement} />
        <Route path="portal" element={<PublicPortalPage />} />
        <Route path="portal/requests/:publicId" element={<PublicPortalRequestPage />} />
        <Route path="portal/:institutionSlug" element={<PublicPortalPage />} />
        <Route path="en" element={publicEntryElement} />
        <Route path="en/contact" element={publicEntryElement} />
        <Route path="en/platform" element={publicEntryElement} />
        <Route path="en/govops" element={<GovOpsPage />} />
        <Route path="en/scrutiny" element={<ScrutinyPage />} />
        <Route path="en/about" element={publicEntryElement} />
        <Route path="en/partners" element={publicEntryElement} />
        <Route path="en/portal" element={<PublicPortalPage />} />
        <Route path="en/portal/requests/:publicId" element={<PublicPortalRequestPage />} />
        <Route path="en/portal/:institutionSlug" element={<PublicPortalPage />} />
        <Route path="es" element={publicEntryElement} />
        <Route path="es/contacto" element={publicEntryElement} />
        <Route path="es/procesos" element={publicEntryElement} />
        <Route path="es/modulos" element={publicEntryElement} />
        <Route path="es/casos" element={publicEntryElement} />
        <Route path="es/plataforma" element={publicEntryElement} />
        <Route path="es/nosotros" element={publicEntryElement} />
        <Route path="es/alianzas" element={publicEntryElement} />
        <Route path="es/portal" element={<PublicPortalPage />} />
        <Route path="es/portal/requests/:publicId" element={<PublicPortalRequestPage />} />
        <Route path="es/portal/:institutionSlug" element={<PublicPortalPage />} />
        <Route path="govops" element={<GovOpsPage />} />
        <Route path="scrutiny" element={<ScrutinyPage />} />
        <Route path="es/govops" element={<GovOpsPage />} />
        <Route path="es/escrutinio" element={<ScrutinyPage />} />
        <Route path="auth" element={<AuthPage />} />
        <Route path="app" element={<ShellEntryRedirect />} />
        <Route path="council-claim/:token" element={<CouncilClaimPage />} />
        <Route path="invite/:token" element={<InviteLandingPage />} />

        <Route element={<CloudAccessGate />}>
          <Route path="onboarding" element={<OnboardingRoutePage />} />
          <Route path="instance" element={<Navigate to="/instance/settings/overview" replace />} />
          <Route path="instance/settings" element={<Layout />}>
            <Route index element={<Navigate to="overview" replace />} />
            <Route path="overview" element={<InstanceAdminOverview />} />
            <Route path="heartbeats" element={<InstanceSettings />} />
            <Route path="tenants" element={<InstanceTenants />} />
            <Route path="cloudflare" element={<InstanceCloudflareSettings />} />
            <Route path="experimental" element={<InstanceExperimentalSettings />} />
            <Route path="plugins" element={<PluginManager />} />
            <Route path="plugins/:pluginId" element={<PluginSettings />} />
          </Route>
          <Route path="institutions" element={<UnprefixedBoardRedirect />} />
          <Route path="institution/settings" element={<UnprefixedBoardRedirect />} />
          <Route path="institution/settings/environments" element={<UnprefixedBoardRedirect />} />
          <Route path="company/settings" element={<UnprefixedBoardRedirect />} />
          <Route path="company/settings/environments" element={<UnprefixedBoardRedirect />} />
          <Route path="dashboard" element={<UnprefixedBoardRedirect />} />
          <Route path="org" element={<UnprefixedBoardRedirect />} />
          <Route path="search" element={<UnprefixedBoardRedirect />} />
          <Route path="workspaces" element={<UnprefixedBoardRedirect />} />
          <Route path="users/:userSlug" element={<UnprefixedBoardRedirect />} />
          <Route path="requests" element={<UnprefixedBoardRedirect />} />
          <Route path="requests/:issueId" element={<UnprefixedBoardRedirect />} />
          <Route path="issues" element={<UnprefixedBoardRedirect />} />
          <Route path="issues/:issueId" element={<UnprefixedBoardRedirect />} />
          <Route path="settings" element={<LegacySettingsRedirect />} />
          <Route path="settings/*" element={<LegacySettingsRedirect />} />
          <Route path="agents" element={<UnprefixedBoardRedirect />} />
          <Route path="agents/new" element={<UnprefixedBoardRedirect />} />
          <Route path="agents/:agentId" element={<UnprefixedBoardRedirect />} />
          <Route path="agents/:agentId/:tab" element={<UnprefixedBoardRedirect />} />
          <Route path="agents/:agentId/runs/:runId" element={<UnprefixedBoardRedirect />} />
          <Route path="projects" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/overview" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/requests" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/requests/:filter" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/issues" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/issues/:filter" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/workspaces" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/configuration" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/budget" element={<UnprefixedBoardRedirect />} />
          <Route path="execution-workspaces/:workspaceId" element={<UnprefixedBoardRedirect />} />
          <Route path="approvals" element={<UnprefixedBoardRedirect />} />
          <Route path="approvals/:approvalId" element={<UnprefixedBoardRedirect />} />
          <Route path="costs" element={<UnprefixedBoardRedirect />} />
          <Route path="activity" element={<UnprefixedBoardRedirect />} />
          <Route path="inbox" element={<UnprefixedBoardRedirect />} />
          <Route path="inbox/:tab" element={<UnprefixedBoardRedirect />} />
          <Route path="tests/ux/runs" element={<UnprefixedBoardRedirect />} />
          <Route path="objectives" element={<UnprefixedBoardRedirect />} />
          <Route path="objectives/:goalId" element={<UnprefixedBoardRedirect />} />
          <Route path=":companyPrefix" element={<Layout />}>
            {councilRoutes()}
          </Route>
          <Route path="*" element={<NotFoundPage scope="global" />} />
        </Route>
      </Routes>
      {companyContext && !isPublicRoute ? <OnboardingWizard /> : null}
    </ErrorBoundary>
  );
}
