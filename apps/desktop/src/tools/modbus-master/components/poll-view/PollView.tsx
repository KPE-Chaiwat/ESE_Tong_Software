import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
} from "react";
import type { PollHostKind } from "@/shared/ipc/modbus-master.types";
import { renderProbe } from "@/shared/lib/render-probe";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Icon } from "@/shared/ui/icon";
import { freshnessTextKind } from "../../lib/status-line";
import type { PollViewRuntime } from "../../runtime/poll-view-runtime";
import { connectionTarget } from "../../store/connection.logic";
import { draftHasEdits } from "../../store/poll-draft.logic";
import {
  PollViewProvider,
  useElementWidth,
  useFrameWidth,
  usePoll,
  usePollConnection,
  usePollData,
  usePollUi,
  usePollViewRuntime,
} from "./context";
import { DataCard } from "./DataCard";
import { OverrideDialog } from "./OverrideDialog";
import { PollSetup } from "./PollSetup";
import {
  type DataViewInput,
  DOCK_WIDTH,
  deriveDataView,
  isWideHeader,
  PANEL_WIDTH,
  POPOVER_WIDTH,
  RAIL_WIDTH,
  type SetupPresentation,
  setupPresentationFor,
  snapViewWidth,
} from "./poll-view.logic";
import { ScaleSection } from "./ScaleSection";
import { StatusLine } from "./StatusLine";
import {
  captureSetupFocus,
  restoreSetupFocus,
  SETUP_HIDE_ANCHOR,
  type SetupFocusSnapshot,
  TOGGLE_FOCUS,
} from "./setup-focus";

export interface PollViewProps {
  /** The runtime of this view (`createPollViewRuntime`). The host disposes it. */
  runtime: PollViewRuntime;
  /** Where this view is hosted: a workspace sub-window or a native window. */
  host: PollHostKind;
  /** The SCALE and OVERRIDES sections of the setup, below the POLL section (default: `ScaleSection`). */
  scaleSection?: ReactNode;
  /** A new poll: focus Name with its text selected when the setup appears. */
  focusName?: boolean;
  /** Maximum height of the setup popover in px (the workspace height minus 48; DES-002 2.3.3). */
  popoverMaxHeight?: number;
  /**
   * The host's frame element (a sub-window's `<section>`). The setup presentation threshold is
   * measured on the real width of this FRAME, borders included (DES-002 2.3.3, REPORT-004 CHK2-E12),
   * never on the body plus a constant: the inactive border computes to 1 px, not 1.5 px. The container
   * queries (header, status line) stay on the view. Without a frame (W2) the view width is used.
   */
  frame?: RefObject<HTMLElement | null>;
  className?: string;
}

/** The presentations that show the setup content (not the closed state and not the rail). */
function hasSetup(p: SetupPresentation): boolean {
  return p === "dock" || p === "panel" || p === "popover";
}

function Body({
  host,
  scaleSection,
  focusName,
  popoverMaxHeight,
  frame,
  className,
}: Omit<PollViewProps, "runtime">) {
  const runtime = usePollViewRuntime();
  const bulkLocked = usePollUi((s) => s.bulkOperationToken !== null);
  // The exact width, reduced to the breakpoints (the status line steps, the wide header, the
  // presentation fallback): every one of them compares the fractional width, and the view renders
  // only when one is crossed, not on every sub-pixel of a resize.
  const [ref, width] = useElementWidth<HTMLDivElement>(snapViewWidth);
  const setupOpen = usePollUi((s) => s.setupOpen);
  const compact = usePollUi((s) => s.compact);
  const setupOverride = usePollUi((s) => s.setupOverride);
  const unapplied = usePollUi((s) => draftHasEdits(s.pollDraft));
  const attach = usePoll((s) => s.attach);
  const config = usePoll((s) => s.config);
  const pollState = usePoll((s) => s.state);
  const exceptionCode = usePoll((s) => s.exceptionCode);
  const status = usePollData((s) => s.status);
  const hasValues = usePollData((s) => s.values !== null);
  // Only whether there is a last update decides the shape of the view. The time itself is read by
  // the freshness chip alone, so the grid does not render with every PollUpdate (REV-005 m-3).
  const hasLastOk = usePollData((s) => s.lastOkAt !== null);
  const clearedBecause = usePollData((s) => s.clearedBecause);
  const connectionState = usePollConnection((s) => s.state);
  const connectionConfig = usePollConnection((s) => s.connection);
  const draftInvalid = usePollUi(
    (s) => s.pollDraft !== null && Object.keys(s.pollDraft.errors).length > 0,
  );

  // Dev only: counts the commits of this view (window.__ESEFACT_RENDERS__, key `poll-view:{id}`).
  const probeKey = `poll-view:${runtime.pollId}`;
  useEffect(() => {
    renderProbe.record(probeKey);
  });

  // The channel is attached when the view appears; the host disposes it when it goes away.
  useEffect(() => {
    void runtime.init();
  }, [runtime]);

  // F6 cycles the regions of a native window: the setup and the data card are two of them.
  const regionAttr = (name: string) => (host === "native" ? { "data-region": name } : {});
  const frameWidth = useFrameWidth(frame);
  const popoverId = useId();
  const presentation = setupPresentationFor(
    host,
    frameWidth ?? width,
    setupOpen,
    compact,
    setupOverride,
  );
  const railRef = useRef<HTMLButtonElement | null>(null);
  const nativePopover = host === "native" && presentation === "popover";
  // The container of the open setup (dock, panel or popover) and the focus it had when it was
  // removed. A width change moves the setup to another container, which React re-creates; the
  // focused control is captured while the old node is still in the document (a ref cleanup runs
  // before the removal) and put back on the equivalent control of the new one (REV-008 m-3).
  const setupContainer = useRef<HTMLElement | null>(null);
  const pendingFocus = useRef<SetupFocusSnapshot | null>(null);
  const previousPresentation = useRef<SetupPresentation | null>(null);
  const captureContainer = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    setupContainer.current = el;
    return () => {
      const snapshot = captureSetupFocus(el);
      if (snapshot) pendingFocus.current = snapshot;
      if (setupContainer.current === el) setupContainer.current = null;
    };
  }, []);
  // The rail leaves in a native window when the popover becomes the panel: its focus moves to the
  // panel's hide button, the same control in its other shape.
  const captureRail = useCallback((el: HTMLButtonElement | null) => {
    railRef.current = el;
    if (!el) return;
    return () => {
      if (el.ownerDocument.activeElement === el) pendingFocus.current = TOGGLE_FOCUS;
      if (railRef.current === el) railRef.current = null;
    };
  }, []);
  // On a change of presentation:
  // - setup to setup (a live resize across 640 px): the focus stays on the same field, with the same
  //   caret or selection; nothing else moves it;
  // - the popover of a native window (below 640 px, REPORT-006 O1) opened from the rail or at the
  //   start: the focus goes to the first invalid field, else Name;
  // - the popover closed: the focus returns to the rail button.
  useLayoutEffect(() => {
    const previous = previousPresentation.current;
    previousPresentation.current = presentation;
    const snapshot = pendingFocus.current;
    pendingFocus.current = null;
    if (previous === presentation) return;
    const container = setupContainer.current;
    if (previous !== null && hasSetup(previous) && hasSetup(presentation)) {
      if (snapshot && container) restoreSetupFocus(container, snapshot, railRef.current);
      return;
    }
    if (nativePopover) {
      const target =
        container?.querySelector<HTMLElement>('[aria-invalid="true"]') ??
        container?.querySelector<HTMLElement>("input");
      (target ?? container)?.focus();
    } else if (previous === "popover" && host === "native") {
      const active = document.activeElement;
      if (!active || active === document.body) railRef.current?.focus();
    }
  }, [presentation, nativePopover, host]);
  const wide = isWideHeader(width);

  const viewInput: Omit<DataViewInput, "lastOkAt"> = {
    host,
    pollState,
    connectionState,
    exceptionCode,
    status,
    hasValues,
    clearedBecause,
    definition: config?.definition ?? {
      slaveId: 1,
      function: 3,
      startAddress: 0,
      quantity: 1,
      scanRateMs: 1000,
    },
    addressBase: config?.display.addressBase ?? 0,
    connectionTarget: connectionConfig ? connectionTarget(connectionConfig) : null,
    draftInvalid,
  };
  const view = deriveDataView({ ...viewInput, lastOkAt: hasLastOk ? 0 : null });

  const setup = config ? (
    <PollSetup
      scaleSection={scaleSection === undefined ? <ScaleSection /> : scaleSection}
      {...(focusName ? { focusName } : {})}
    />
  ) : null;

  return (
    // biome-ignore lint/a11y/useSemanticElements: a named group of a status line, a setup and a data card; a <fieldset> would give it form semantics.
    <div
      ref={ref}
      role="group"
      aria-label="Poll view"
      data-slot="poll-view"
      inert={bulkLocked}
      aria-busy={bulkLocked}
      data-host={host}
      data-poll-id={runtime.pollId}
      data-attach={attach}
      data-ready={attach === "attached" ? "true" : "false"}
      data-layout={wide ? "wide" : "narrow"}
      data-presentation={presentation}
      className={cn(
        "@container relative flex h-full min-h-0 min-w-0 flex-col bg-card text-foreground",
        className,
      )}
    >
      <StatusLine
        chipInput={viewInput}
        compact={!wide}
        width={width}
        freshness={freshnessTextKind(view.chip?.kind ?? null)}
      />
      <div className="flex min-h-0 flex-1 gap-2 p-2">
        {presentation === "dock" ? (
          <aside
            ref={captureContainer}
            aria-label="Poll setup"
            data-slot="setup-dock"
            data-presentation="dock"
            style={{ width: DOCK_WIDTH }}
            className="shrink-0 overflow-y-auto rounded-lg border bg-card p-3"
          >
            {setup}
          </aside>
        ) : null}
        {presentation === "panel" ? (
          <aside
            ref={captureContainer}
            aria-label="Poll setup"
            data-slot="setup-panel"
            data-presentation="panel"
            {...regionAttr("setup")}
            style={{ width: PANEL_WIDTH }}
            className="flex shrink-0 flex-col gap-3 overflow-y-auto rounded-lg border bg-card p-3"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase text-text-muted">Setup</h2>
              <button
                type="button"
                data-focus-anchor={SETUP_HIDE_ANCHOR}
                aria-label="Hide setup (Ctrl+\)"
                title="Hide setup (Ctrl+\)"
                onClick={() => runtime.stores.ui.getState().setSetupOpen(false)}
                className="inline-flex size-6 items-center justify-center rounded-md outline-none hover:bg-neutral-tint focus-ring"
              >
                <Icon name="chevron-left" />
              </button>
            </div>
            {setup}
          </aside>
        ) : null}
        {presentation === "rail" || nativePopover ? (
          <button
            ref={captureRail}
            type="button"
            aria-label="Show setup (Ctrl+\)"
            aria-expanded={nativePopover}
            aria-controls={nativePopover ? popoverId : undefined}
            title="Show setup (Ctrl+\)"
            data-slot="setup-rail"
            data-presentation="rail"
            {...regionAttr(nativePopover ? "setup-rail" : "setup")}
            style={{ width: RAIL_WIDTH }}
            onClick={() => runtime.stores.ui.getState().toggleSetup()}
            className="relative flex shrink-0 flex-col items-center gap-2 rounded-lg border bg-card py-2 text-xs font-semibold outline-none hover:bg-neutral-tint focus-ring"
          >
            <Icon name="chevron-right" />
            <span className="[writing-mode:vertical-rl]">Setup</span>
            {unapplied ? (
              <>
                <span
                  aria-hidden="true"
                  data-testid="rail-unapplied"
                  className="absolute bottom-1.5 size-2 rounded-full bg-dark"
                />
                <span className="sr-only">Unapplied changes</span>
              </>
            ) : null}
          </button>
        ) : null}
        <div className="contents" {...regionAttr("data")}>
          <DataCard view={view} chipInput={viewInput} wideHeader={wide} />
        </div>
      </div>
      {presentation === "popover" ? (
        <div
          ref={captureContainer}
          id={popoverId}
          role="dialog"
          aria-label="Poll setup"
          aria-modal="false"
          tabIndex={-1}
          data-slot="setup-popover"
          data-presentation="popover"
          {...regionAttr("setup")}
          style={{
            width: POPOVER_WIDTH,
            // A native window anchors it to the right edge of the rail (left edge at 30 px), 8 px
            // above the bottom at most; a sub-window to the right edge of its frame.
            ...(host === "native"
              ? { left: RAIL_WIDTH, maxHeight: "calc(100% - 44px)" }
              : popoverMaxHeight
                ? { maxHeight: popoverMaxHeight }
                : {}),
          }}
          onKeyDown={(e) => {
            // Closes on Esc, on the setup button and on Done; never on an outside click (to protect edits).
            if (e.key === "Escape") {
              e.stopPropagation();
              runtime.stores.ui.getState().closeSetup();
            }
          }}
          className={cn(
            "absolute top-9 z-30 flex flex-col gap-3 overflow-y-auto rounded-lg border bg-card p-3 shadow-lg outline-none",
            host === "native" ? "" : "right-2 max-h-[calc(100%-48px)]",
          )}
        >
          {setup}
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => runtime.stores.ui.getState().closeSetup()}
            >
              Done
            </Button>
          </div>
        </div>
      ) : null}
      <OverrideDialog />
    </div>
  );
}

/**
 * The poll view shared by both hosts (DES-002 2.3): status line, setup presentation, data card with
 * the Alias, Address, Raw and Scaled columns. It receives only its runtime and the host it is in;
 * it does not know which window that is.
 */
export function PollView({ runtime, host, ...rest }: PollViewProps) {
  return (
    <PollViewProvider runtime={runtime}>
      <Body host={host} {...rest} />
    </PollViewProvider>
  );
}
