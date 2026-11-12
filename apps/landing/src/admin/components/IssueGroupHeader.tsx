import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function IssueGroupHeader({
  label,
  trailing,
  className,
}: {
  label: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3 text-xs font-semibold uppercase", className)}>
      <span className="truncate">{label}</span>
      {trailing ? <span className="shrink-0">{trailing}</span> : null}
    </div>
  );
}
