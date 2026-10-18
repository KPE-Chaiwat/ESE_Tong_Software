import { useStore } from "zustand";
import { useAltGuard } from "@/shared/lib/alt-guard";
import { Toaster } from "@/shared/ui/toaster";
import { ClosePollDialogView, DeletePollDialogView } from "../dialogs/PollDialogViews";
import { WriteDialogView } from "../dialogs/WriteDialogView";
import { PollView } from "../poll-view/PollView";
import { LiveRegionsFor } from "../shell/LiveRegions";
import { NATIVE_REGION_ORDER, useRegionCycle } from "../shell/use-regions";
import { useNativeHost, useNativePoll, useNativePrefs, useNativeRuntime } from "./context";
import { NativeBanner } from "./NativeBanner";
import { NativeStatusBar } from "./NativeStatusBar";
import { NativeToolbar } from "./NativeToolbar";
import { useNativeShortcuts } from "./use-native-shortcuts";

/** Write (S2), Close poll window? and Delete poll? in this window (DES-002 2.11, 3.3). */
function NativeDialogs() {
  const runtime = useNativeRuntime();
  const { stores } = runtime;
  const writing = useStore(stores.write, (s) => s.open);
  const closing = useNativeHost((s) => s.closing);
  const deleting = useNativeHost((s) => s.deleting);
  const config = useNativePoll((s) => s.config);
  return (
    <>
      {writing ? (
        <WriteDialogView
          write={stores.write}
          layout={stores.layout}
          connection={stores.connection}
          config={config}
          scaled={runtime.view.scaled()}
          reconnect={() => void runtime.actions.connectOrReconnect()}
        />
      ) : null}
      {closing !== null ? (
        <ClosePollDialogView host={stores.host} layout={stores.layout} present={config !== null} />
      ) : null}
      {deleting !== null ? (
        <DeletePollDialogView
          host={stores.host}
          layout={stores.layout}
          name={config?.name ?? null}
        />
      ) : null}
    </>
  );
}

/** What a native window says when its view is gone (Rust is closing the window). */
const selectPrefsJson = (s: { askOnPollClose: boolean; compact: boolean }): string =>
  JSON.stringify({ askOnPollClose: s.askOnPollClose, compact: s.compact });

function DetachedNotice() {
  const attach = useNativePoll((s) => s.attach);
  const reason = useNativePoll((s) => s.detachReason);
  const removed = useNativePoll((s) => s.removed);
  const error = useNativePoll((s) => s.attachError);
  if (attach !== "detached" && !removed) return null;
  const text = error
    ? `Could not open this poll: ${error}`
    : removed
      ? "This poll was deleted."
      : reason === "replaced"
        ? "This poll is shown in another window."
        : "This poll window is closing.";
  return (
    <p role="status" data-testid="native-detached" className="px-4 py-2 text-sm text-text-muted">
      {text}
    </p>
  );
}

/**
 * The native poll window W2 (DES-002 2.6): toolbar, banner, the shared PollView with
 * `host="native"`, and the status bar. One runtime per window.
 */
export function NativePollWindow() {
  const runtime = useNativeRuntime();
  useNativeShortcuts();
  useAltGuard();
  useRegionCycle(NATIVE_REGION_ORDER);
  const ready = useStore(runtime.stores.ready, (s) => s.ready);
  // The preferences this window has applied (from the snapshot and `PrefsChanged`), as JSON.
  const prefs = useNativePrefs(selectPrefsJson);
  return (
    <div
      data-native-window=""
      data-ready={ready ? "true" : "false"}
      data-prefs={prefs}
      data-poll-id={runtime.pollId}
      // `overflow-hidden`: the page never scrolls (REPORT-007 D6); only the grid scrolls, inside.
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground"
    >
      <NativeToolbar />
      <NativeBanner />
      <DetachedNotice />
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <PollView runtime={runtime.view} host="native" />
      </div>
      <NativeStatusBar />
      <NativeDialogs />
      <Toaster store={runtime.stores.toasts} />
      <LiveRegionsFor store={runtime.stores.announcer} />
    </div>
  );
}
