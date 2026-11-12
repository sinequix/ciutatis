import { Plus, ArrowRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  icon: LucideIcon;
  message: string;
  description?: string;
  action?: string;
  onAction?: () => void;
  secondaryAction?: string;
  onSecondaryAction?: () => void;
}

export function EmptyState({
  icon: Icon,
  message,
  description,
  action,
  onAction,
  secondaryAction,
  onSecondaryAction,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-4">
      <div className="bg-muted/50 p-4 mb-4 rounded-xl">
        <Icon className="h-10 w-10 text-muted-foreground/50" />
      </div>
      <p className="text-sm font-medium text-foreground mb-1">{message}</p>
      {description && (
        <p className="text-sm text-muted-foreground mb-4 max-w-sm">{description}</p>
      )}
      <div className="flex flex-col sm:flex-row items-center gap-2">
        {action && onAction && (
          <Button onClick={onAction}>
            <Plus className="h-4 w-4 mr-1.5" />
            {action}
          </Button>
        )}
        {secondaryAction && onSecondaryAction && (
          <Button variant="ghost" onClick={onSecondaryAction}>
            {secondaryAction}
            <ArrowRight className="h-4 w-4 ml-1.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
