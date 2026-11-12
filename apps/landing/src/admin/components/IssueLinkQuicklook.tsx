import type { ReactNode } from "react";
import { Link } from "@/lib/router";

type IssueLinkQuicklookProps = {
  to: string;
  issuePathId?: string;
  className?: string;
  children: ReactNode;
};

export function IssueLinkQuicklook({
  to,
  className,
  children,
}: IssueLinkQuicklookProps) {
  return (
    <Link to={to} className={className}>
      {children}
    </Link>
  );
}
