import {
  Activity,
  ArrowDown,
  ArrowUp,
  CircleCheck,
  CircleX,
  Clock,
  Link,
  Loader,
  OctagonX,
  Pause,
  Plug,
  TimerOff,
  TriangleAlert,
  Unplug,
} from "lucide-react";
import type { ComponentType } from "react";
import { useReducedMotion } from "@/shared/lib/use-reduced-motion";
import { cn } from "@/shared/lib/utils";

const ICONS = {
  plug: Plug,
  loader: Loader,
  link: Link,
  activity: Activity,
  pause: Pause,
  "timer-off": TimerOff,
  "octagon-x": OctagonX,
  "triangle-alert": TriangleAlert,
  unplug: Unplug,
  "circle-check": CircleCheck,
  "circle-x": CircleX,
  clock: Clock,
  "arrow-up": ArrowUp,
  "arrow-down": ArrowDown,
} as const satisfies Record<string, ComponentType<{ className?: string }>>;

export type IconName = keyof typeof ICONS;

export type IconTone = "default" | "error";

interface IconProps {
  name: IconName;
  tone?: IconTone;
  className?: string;
}

/**
 * Status icon, identified by `data-icon` (the lucide name). Icons are decorative: the text label
 * next to them carries the meaning (never color only). The loader spins unless the user prefers
 * reduced motion. Only icons may use the error color on light surfaces (DES-001 6.2).
 */
export function Icon({ name, tone = "default", className }: IconProps) {
  const reduced = useReducedMotion();
  const Component = ICONS[name];
  return (
    <Component
      data-icon={name}
      aria-hidden="true"
      className={cn(
        "size-4 shrink-0",
        tone === "error" && "text-error",
        name === "loader" && !reduced && "animate-spin",
        className,
      )}
    />
  );
}
