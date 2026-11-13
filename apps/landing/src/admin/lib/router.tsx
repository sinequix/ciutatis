import * as React from "react";
import * as RouterDom from "react-router-dom";
import type { NavigateOptions, To } from "react-router-dom";
import { useOptionalCompany } from "@/context/CompanyContext";
import {
  applyCompanyPrefix,
  caseHref,
  extractCompanyPrefixFromPath,
  normalizeCompanyPrefix,
} from "@/lib/company-routes";

function resolveTo(to: To, companyPrefix: string | null): To {
  if (typeof to === "string") {
    return applyCompanyPrefix(to, companyPrefix);
  }

  if (to.pathname && to.pathname.startsWith("/")) {
    const pathname = applyCompanyPrefix(to.pathname, companyPrefix);
    if (pathname !== to.pathname) {
      return { ...to, pathname };
    }
  }

  return to;
}

function useActiveCompanyPrefix(): string | null {
  const company = useOptionalCompany();
  const params = RouterDom.useParams<{ companyPrefix?: string }>();
  const location = RouterDom.useLocation();

  if (params.companyPrefix) {
    return normalizeCompanyPrefix(params.companyPrefix);
  }

  const pathPrefix = extractCompanyPrefixFromPath(location.pathname);
  if (pathPrefix) return pathPrefix;

  return company?.selectedCompany ? normalizeCompanyPrefix(company.selectedCompany.issuePrefix) : null;
}

/**
 * Returns a builder for company-prefixed Cases hrefs bound to the active company
 * (e.g. `/PAP/cases/PAP-C5`). Use for all case-to-case links so they emit
 * prefixed paths directly instead of leaning on the PAP-13002 redirect.
 */
export function useCaseHref(): (...segments: string[]) => string {
  const companyPrefix = useActiveCompanyPrefix();
  return React.useCallback(
    (...segments: string[]) => caseHref(companyPrefix, ...segments),
    [companyPrefix],
  );
}

export * from "react-router-dom";

export const Link = React.forwardRef<HTMLAnchorElement, React.ComponentProps<typeof RouterDom.Link>>(
  function CompanyLink({ to, ...props }, ref) {
    const companyPrefix = useActiveCompanyPrefix();
    return <RouterDom.Link ref={ref} to={resolveTo(to, companyPrefix)} {...props} />;
  },
);

export const NavLink = React.forwardRef<HTMLAnchorElement, React.ComponentProps<typeof RouterDom.NavLink>>(
  function CompanyNavLink({ to, ...props }, ref) {
    const companyPrefix = useActiveCompanyPrefix();
    return <RouterDom.NavLink ref={ref} to={resolveTo(to, companyPrefix)} {...props} />;
  },
);

export function Navigate({ to, ...props }: React.ComponentProps<typeof RouterDom.Navigate>) {
  const companyPrefix = useActiveCompanyPrefix();
  return <RouterDom.Navigate to={resolveTo(to, companyPrefix)} {...props} />;
}

export function useNavigate(): ReturnType<typeof RouterDom.useNavigate> {
  const navigate = RouterDom.useNavigate();
  const companyPrefix = useActiveCompanyPrefix();

  return React.useCallback(
    ((to: To | number, options?: NavigateOptions) => {
      if (typeof to === "number") {
        navigate(to);
        return;
      }
      navigate(resolveTo(to, companyPrefix), options);
    }) as ReturnType<typeof RouterDom.useNavigate>,
    [navigate, companyPrefix],
  );
}
