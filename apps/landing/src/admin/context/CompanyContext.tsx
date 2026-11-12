import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Company } from "@paperclipai/shared";
import { useLocation } from "@/lib/router";
import { companiesApi } from "../api/companies";
import { companiesListQueryOptions, type CompanyListResult } from "../api/companies-query";
import { queryKeys } from "../lib/queryKeys";
import type { CompanySelectionSource } from "../lib/company-selection";
import { isPublicSitePath } from "../lib/public-site-paths";
type CompanySelectionOptions = { source?: CompanySelectionSource };
type CompanyQueryResult = { companies: Company[]; unauthorized: boolean };
type CompanySelectionCompany = Pick<Company, "id">;

interface CompanyContextValue {
  companies: Company[];
  selectedCompanyId: string | null;
  selectedCompany: Company | null;
  selectionSource: CompanySelectionSource;
  loading: boolean;
  error: Error | null;
  setSelectedCompanyId: (companyId: string, options?: CompanySelectionOptions) => void;
  reloadCompanies: () => Promise<void>;
  createCompany: (data: {
    name: string;
    description?: string | null;
    budgetMonthlyCents?: number;
  }) => Promise<Company>;
}

const STORAGE_KEY = "paperclip.selectedCompanyId";

const CompanyContext = createContext<CompanyContextValue | null>(null);

export function resolveBootstrapCompanySelection({
  companies,
  sidebarCompanies,
  selectedCompanyId,
  storedCompanyId,
}: {
  companies: CompanySelectionCompany[];
  sidebarCompanies: CompanySelectionCompany[];
  selectedCompanyId: string | null;
  storedCompanyId: string | null;
}) {
  if (companies.length === 0) return null;
  const selectableCompanies = sidebarCompanies.length > 0 ? sidebarCompanies : companies;
  if (selectedCompanyId && selectableCompanies.some((company) => company.id === selectedCompanyId)) {
    return selectedCompanyId;
  }
  if (storedCompanyId && selectableCompanies.some((company) => company.id === storedCompanyId)) {
    return storedCompanyId;
  }
  return selectableCompanies[0]?.id ?? null;
}

export function shouldClearStoredCompanySelection({
  companies,
  isLoading,
  unauthorized,
}: {
  companies: CompanySelectionCompany[];
  isLoading: boolean;
  unauthorized: boolean;
}) {
  return !isLoading && !unauthorized && companies.length === 0;
}

function normalizeCompaniesQueryResult(data: CompanyQueryResult | Company[] | undefined): CompanyQueryResult {
  if (Array.isArray(data)) {
    return { companies: data, unauthorized: false };
  }
  return data ?? { companies: [], unauthorized: false };
}

function useSafeLocationPathname() {
  try {
    return useLocation().pathname;
  } catch {
    return typeof window === "undefined" ? "/" : window.location.pathname;
  }
}

export function CompanyProvider({ children }: { children: ReactNode }) {
  const pathname = useSafeLocationPathname();
  const queryClient = useQueryClient();
  const [selectionSource, setSelectionSource] = useState<CompanySelectionSource>("bootstrap");
  const [selectedCompanyId, setSelectedCompanyIdState] = useState<string | null>(null);
  const isPublicRoute = isPublicSitePath(pathname);

  const { data: companiesQuery, isLoading, error } = useQuery<CompanyQueryResult>({
    queryKey: queryKeys.companies.all,
    queryFn: async () => {
      try {
        return { companies: await companiesApi.list(), unauthorized: false };
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          return { companies: [], unauthorized: true };
        }
        throw err;
      }
    },
    enabled: !isPublicRoute,
    retry: false,
  });
  const { companies, unauthorized } = normalizeCompaniesQueryResult(companiesQuery);
  const sidebarCompanies = useMemo(
    () => companies.filter((company) => company.status !== "archived"),
    [companies],
  );

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    const next = resolveBootstrapCompanySelection({
      companies,
      sidebarCompanies,
      selectedCompanyId,
      storedCompanyId: stored,
    });
    if (next === selectedCompanyId) return;
    setSelectedCompanyIdState(next);
    setSelectionSource("bootstrap");
    if (next) {
      localStorage.setItem(STORAGE_KEY, next);
    } else if (shouldClearStoredCompanySelection({ companies, isLoading, unauthorized })) {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [companies, isLoading, selectedCompanyId, sidebarCompanies, unauthorized]);

  const setSelectedCompanyId = useCallback((companyId: string, options?: CompanySelectionOptions) => {
    setSelectedCompanyIdState(companyId);
    setSelectionSource(options?.source ?? "manual");
    localStorage.setItem(STORAGE_KEY, companyId);
  }, []);

  const reloadCompanies = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
  }, [queryClient]);

  const createMutation = useMutation({
    mutationFn: (data: {
      name: string;
      description?: string | null;
      budgetMonthlyCents?: number;
    }) =>
      companiesApi.create(data),
    onSuccess: (company) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      setSelectedCompanyId(company.id);
    },
  });

  const createCompany = useCallback(
    async (data: {
      name: string;
      description?: string | null;
      budgetMonthlyCents?: number;
    }) => {
      return createMutation.mutateAsync(data);
    },
    [createMutation],
  );

  const selectedCompany = useMemo(
    () => companies.find((company) => company.id === selectedCompanyId) ?? null,
    [companies, selectedCompanyId],
  );

  const value = useMemo(
    () => ({
      companies,
      selectedCompanyId,
      selectedCompany,
      selectionSource,
      loading: isLoading,
      error: error as Error | null,
      setSelectedCompanyId,
      reloadCompanies,
      createCompany,
    }),
    [
      companies,
      selectedCompanyId,
      selectedCompany,
      selectionSource,
      isLoading,
      error,
      setSelectedCompanyId,
      reloadCompanies,
      createCompany,
    ],
  );

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

export function useCompany() {
  const ctx = useContext(CompanyContext);
  if (!ctx) {
    throw new Error("useCompany must be used within CompanyProvider");
  }
  return ctx;
}

export function useOptionalCompany() {
  return useContext(CompanyContext);
}
