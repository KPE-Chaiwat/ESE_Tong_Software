import {
  Activity,
  AppWindow,
  ArrowDown,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUp,
  ArrowUpToLine,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  CircleX,
  Clock,
  Columns3,
  Copy,
  Ellipsis,
  EyeOff,
  FilePenLine,
  Gauge,
  GripVertical,
  Info,
  Layers,
  LayoutGrid,
  Link,
  Loader,
  Minus,
  OctagonX,
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Pencil,
  Play,
  Plug,
  Plus,
  Settings2,
  SlidersHorizontal,
  Square,
  SquareArrowDownLeft,
  SquareArrowOutUpRight,
  TimerOff,
  TriangleAlert,
  Unplug,
  WifiOff,
  X,
} from "lucide-react";
import type { ComponentType } from "react";
import { useReducedMotion } from "@/shared/lib/use-reduced-motion";
import { cn } from "@/shared/lib/utils";

const ICONS = {
  "panel-left-close": PanelLeftClose,
  "panel-left-open": PanelLeftOpen,
  plug: Plug,
  loader: Loader,
  link: Link,
  activity: Activity,
  pause: Pause,
  play: Play,
  "file-pen-line": FilePenLine,
  "app-window": AppWindow,
  "timer-off": TimerOff,
  "octagon-x": OctagonX,
  "triangle-alert": TriangleAlert,
  unplug: Unplug,
  "circle-check": CircleCheck,
  "circle-x": CircleX,
  clock: Clock,
  "columns-3": Columns3,
  "arrow-up": ArrowUp,
  "arrow-down": ArrowDown,
  // Multi-poll workspace (DES-002 section 5).
  "wifi-off": WifiOff,
  "settings-2": Settings2,
  "square-arrow-out-up-right": SquareArrowOutUpRight,
  "square-arrow-down-left": SquareArrowDownLeft,
  ellipsis: Ellipsis,
  "eye-off": EyeOff,
  minus: Minus,
  square: Square,
  copy: Copy,
  x: X,
  "layout-grid": LayoutGrid,
  layers: Layers,
  "chevron-down": ChevronDown,
  "chevron-up": ChevronUp,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  "grip-vertical": GripVertical,
  "arrow-left-right": ArrowLeftRight,
  gauge: Gauge,
  check: Check,
  pencil: Pencil,
  "sliders-horizontal": SlidersHorizontal,
  "arrow-down-to-line": ArrowDownToLine,
  "arrow-up-to-line": ArrowUpToLine,
  plus: Plus,
  "panel-left": PanelLeft,
  info: Info,
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
