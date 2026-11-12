import * as React from "react";
import { cn } from "@/lib/utils";

type ToggleSwitchProps = Omit<React.ComponentProps<"button">, "onChange"> & {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  size?: "sm" | "md" | "lg";
};

const SIZE_CLASSES = {
  sm: {
    track: "h-5 w-9",
    thumb: "h-4 w-4 data-[state=checked]:translate-x-4",
  },
  md: {
    track: "h-6 w-10",
    thumb: "h-5 w-5 data-[state=checked]:translate-x-4",
  },
  lg: {
    track: "h-7 w-12",
    thumb: "h-6 w-6 data-[state=checked]:translate-x-5",
  },
} as const;

export function ToggleSwitch({
  checked = false,
  onCheckedChange,
  size = "md",
  disabled,
  className,
  onClick,
  ...props
}: ToggleSwitchProps) {
  const state = checked ? "checked" : "unchecked";
  const classes = SIZE_CLASSES[size] ?? SIZE_CLASSES.md;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      data-state={state}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border border-transparent bg-muted p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary",
        classes.track,
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          onCheckedChange?.(!checked);
        }
      }}
      {...props}
    >
      <span
        data-state={state}
        className={cn(
          "block rounded-full bg-background shadow-sm transition-transform",
          classes.thumb,
        )}
      />
    </button>
  );
}
