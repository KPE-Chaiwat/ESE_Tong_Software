import { type ReactNode, useRef, useState } from "react";
import { useStore } from "zustand";
import { useTruncationTitle } from "@/shared/lib/use-truncation-title";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Icon, type IconName } from "@/shared/ui/icon";
import { MenuButton, type MenuEntry } from "@/shared/ui/menu";
import { StatusPill } from "@/shared/ui/status-pill";
import { arrangeMenuEntries } from "../../lib/arrange-menu";
import { connectionPillFor } from "../../store/connection.logic";
import { pauseButtonLabel } from "../../store/native-poll.logic";
import { pollPillFor } from "../../store/poll.logic";
import { InlineRename } from "../InlineRename";
import { useElementWidth } from "../poll-view/context";
import {
  useNativeArrange,
  useNativeConnection,
  useNativePoll,
  useNativePrefs,
  useNativeRuntime,
} from "./context";
import {
  snapToolbarWidth,
  type ToolbarLayout,
  toolbarLabelMode,
  toolbarLayoutFor,
} from "./native-toolbar.logic";

/** Write… needs a link: the title of the disabled button (DES-001 2.5 "not connected"). */
export const WRITE_DISABLED_TITLE = "Not connected. Connect before writing.";

/**
 * One toolbar button. Full mode: text (and its icon, if it has one) as today. Icon mode (below 640 px,
 * DES-002 2.6): only the 32 px icon button, whose `aria-label` and `title` are the full name; the DOM
 * order and the focus order do not change between the modes.
 */
function ToolbarButton({
  layout,
  label,
  icon,
  iconInFull = false,
  fullTitle,
  iconTitle,
  children,
  className,
  ...props
}: {
  layout: ToolbarLayout;
  /** The full name: the text in full mode, the accessible name and tooltip in icon mode. */
  label: string;
  /** The icon in icon mode (and in full mode when the button has one). */
  icon: IconName;
  /** True when the button shows its icon in full mode too (Dock to workspace). */
  iconInFull?: boolean;
  fullTitle: string;
  /** Tooltip in icon mode; default: the label. */
  iconTitle?: string;
  children?: ReactNode;
  className?: string;
} & Omit<React.ComponentProps<typeof Button>, "size" | "variant" | "title" | "aria-label">) {
  const iconOnly = layout.mode === "icon";
  return (
    <Button
      size={iconOnly ? "icon-sm" : "sm"}
      variant="outline"
      title={iconOnly ? (iconTitle ?? label) : fullTitle}
      aria-label={iconOnly ? label : undefined}
      className={className}
      {...props}
    >
      {iconOnly || iconInFull ? <Icon name={icon} /> : null}
      {iconOnly ? null : label}
      {children}
    </Button>
  );
}

/** The poll name; it is cut first (never below 80 px) and its title holds the whole name when cut. */
function PollName({ name, layout }: { name: string; layout: ToolbarLayout }) {
  const ref = useRef<HTMLHeadingElement | null>(null);
  useTruncationTitle(ref, name);
  return (
    <h1
      ref={ref}
      className={cn("min-w-20 truncate text-[17px] font-bold", layout.name)}
      data-testid="native-poll-name"
    >
      {name}
    </h1>
  );
}

/** The poll name with its pencil, the state pill and the Pause and Write buttons. */
function NameAndState({
  renaming,
  onRename,
  layout,
}: {
  renaming: boolean;
  onRename: (on: boolean) => void;
  layout: ToolbarLayout;
}) {
  const { view } = useNativeRuntime();
  const poll = view.stores.poll;
  const name = useNativePoll((s) => s.config?.name ?? "");
  const state = useNativePoll((s) => s.state);
  const exceptionCode = useNativePoll((s) => s.exceptionCode);
  const hasValues = useStore(view.stores.data, (s) => s.values !== null);
  const pill = pollPillFor(state, exceptionCode, hasValues);
  const pending = useNativePoll((s) => s.pending);
  const loaded = useNativePoll((s) => s.config !== null);
  const linkUp = useNativeConnection((s) => s.state === "connected");
  const pauseLabel = pauseButtonLabel(state);

  return (
    <>
      {renaming ? (
        <span className={cn("min-w-0 shrink", layout.renameWidth)}>
          <InlineRename
            name={name}
            inputClassName="h-8 text-[17px]"
            onCommit={(text) => poll.getState().rename(text)}
            onDone={() => onRename(false)}
          />
        </span>
      ) : (
        <>
          <PollName name={name} layout={layout} />
          {loaded ? (
            <button
              type="button"
              aria-label="Rename poll (F2)"
              title="Rename poll (F2)"
              onClick={() => onRename(true)}
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-md outline-none hover:bg-neutral-tint focus-ring"
            >
              <Icon name="pencil" />
            </button>
          ) : null}
        </>
      )}
      {loaded ? (
        <>
          <StatusPill variant={pill.variant} icon={pill.icon} label={pill.label} />
          <ToolbarButton
            layout={layout}
            label={pauseLabel}
            icon={pauseLabel === "Pause" ? "pause" : "play"}
            fullTitle={`${pauseLabel} (Ctrl+P)`}
            disabled={pending === "active"}
            onClick={() => void view.actions.toggleActive()}
          />
          <ToolbarButton
            layout={layout}
            label="Write…"
            icon="file-pen-line"
            fullTitle={linkUp ? "Write… (Ctrl+E)" : WRITE_DISABLED_TITLE}
            // Icon mode: the name exactly; while not connected the reason stays (DES-001 2.5).
            iconTitle={linkUp ? "Write…" : WRITE_DISABLED_TITLE}
            disabled={!linkUp}
            onClick={() => view.hostActions.write?.(null)}
          />
        </>
      ) : null}
    </>
  );
}

/** The `⋯` menu: Arrange poll windows ▸ (M2) and Collapse setup panels (DES-002 2.6). */
function WindowMenu() {
  const { actions, stores } = useNativeRuntime();
  const monitors = useNativeArrange((s) => s.monitors);
  const target = useNativeArrange((s) => s.target);
  const compact = useNativePrefs((s) => s.compact);
  const entries: MenuEntry[] = [
    {
      kind: "submenu",
      id: "arrange",
      label: "Arrange poll windows",
      onOpen: () => void stores.arrange.getState().loadMonitors(),
      entries: arrangeMenuEntries({
        monitors,
        target,
        tileShortcut: "Ctrl+Shift+T",
        onArrange: (layout) => void actions.arrange(layout),
        onTarget: (t) => stores.arrange.getState().setTarget(t),
      }),
    },
    { kind: "separator", id: "sep" },
    {
      kind: "check",
      id: "compact",
      label: "Collapse setup panels",
      shortcut: "Ctrl+Shift+\\",
      checked: compact,
      onSelect: () => void actions.toggleCompact(),
    },
  ];
  return (
    <MenuButton
      label="Poll window menu"
      entries={entries}
      alignEnd
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-md outline-none hover:bg-neutral-tint focus-ring"
    >
      <Icon name="ellipsis" />
    </MenuButton>
  );
}

/**
 * The toolbar of a native poll window (DES-002 2.6): name (F2 renames), state pill, Pause or Resume,
 * Write…, the connection mini-pill, Connection window, Dock to workspace and the `⋯` menu. At least
 * 60 px high with labels (window width >= 640 css px); below that the four buttons are icon-only and
 * the toolbar is as high as its rows. Two groups, so at most two rows at every width (REPORT-008 D10).
 */
export function NativeToolbar() {
  const { actions } = useNativeRuntime();
  const [renaming, setRenaming] = useState(false);
  const connection = useNativeConnection((s) => s.state);
  const pending = useNativePoll((s) => s.pending);
  const loaded = useNativePoll((s) => s.config !== null);
  const pill = connectionPillFor(connection);
  // The toolbar is a full-width block: its width is the window width. Re-rendered only when the
  // icon-only threshold is crossed.
  const [ref, width] = useElementWidth<HTMLDivElement>(snapToolbarWidth);
  const layout = toolbarLayoutFor(toolbarLabelMode(width));

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label="Poll window toolbar"
      data-region="toolbar"
      data-slot="native-toolbar"
      data-label-mode={layout.mode}
      onKeyDown={(e) => {
        // F2 renames from anywhere in the toolbar; a field of its own keeps its keys.
        if (e.key === "F2" && !(e.target instanceof HTMLInputElement) && loaded) {
          e.preventDefault();
          setRenaming(true);
        }
      }}
      className={layout.root}
    >
      <div data-slot="toolbar-main" className={cn("min-w-0 flex-auto", layout.group)}>
        <NameAndState renaming={renaming} onRename={setRenaming} layout={layout} />
      </div>
      <div data-slot="toolbar-connection" className={cn("ml-auto shrink-0", layout.group)}>
        <StatusPill variant={pill.variant} icon={pill.icon} label={pill.label} />
        <ToolbarButton
          layout={layout}
          label="Connection window"
          icon="app-window"
          fullTitle="Connection window (Ctrl+Shift+M)"
          onClick={() => void actions.focusConnectionWindow()}
        />
        <ToolbarButton
          layout={layout}
          label="Dock to workspace"
          icon={pending === "dock" ? "loader" : "square-arrow-down-left"}
          iconInFull
          fullTitle="Dock to workspace (Ctrl+Shift+D)"
          disabled={!loaded}
          // Busy: aria-disabled keeps the keyboard focus on the button (DES-002 2.5.3).
          aria-busy={pending === "dock" ? true : undefined}
          aria-disabled={pending === "dock" ? true : undefined}
          data-focus-target="command"
          className="aria-disabled:cursor-default aria-disabled:opacity-50"
          onClick={() => {
            if (pending !== "dock") void actions.dock("button");
          }}
        />
        <WindowMenu />
      </div>
    </div>
  );
}
