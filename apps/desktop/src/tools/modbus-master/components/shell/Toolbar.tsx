import { PanelLeft } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Icon } from "@/shared/ui/icon";
import { StatusPill } from "@/shared/ui/status-pill";
import { isDirty } from "../../store/config.logic";
import { actionsFor, pillFor } from "../../store/session.logic";
import { useConfig, useController, useRuntime, useSession } from "../context";

/** Button that shows a spinner while its command is pending. */
function SessionButton({
  pending,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { pending?: boolean }) {
  return (
    <Button size="sm" {...props} disabled={pending || props.disabled}>
      {pending ? <Icon name="loader" /> : null}
      {children}
    </Button>
  );
}

/** Top bar: setup toggle, profile, profile actions, state pill and the session actions. */
export function Toolbar() {
  const runtime = useRuntime();
  const controller = useController();
  const { layout, dialogs } = runtime.stores;
  const state = useSession((s) => s.state);
  const pending = useSession((s) => s.pending);
  // Until the snapshot is applied the buttons would act on a guessed state (REV-002 m7).
  const ready = useSession((s) => s.ready);
  const exceptionCode = useSession((s) => s.exceptionCode);
  const profileName = useConfig((s) => s.profileName);
  const dirty = useConfig((s) => isDirty(s));
  const pill = pillFor(state, exceptionCode);
  const can = actionsFor(state);

  return (
    <div
      role="toolbar"
      aria-label="Toolbar"
      className="flex min-h-12 flex-wrap items-center gap-2 px-3 py-1.5"
    >
      <Button
        size="sm"
        variant="outline"
        aria-label="Toggle setup panel"
        title="Setup (Ctrl+\)"
        onClick={() => layout.getState().toggleSetup()}
      >
        <PanelLeft aria-hidden="true" />
        Setup
      </Button>

      <div className="flex items-center gap-2" data-testid="profile">
        <span className="text-sm font-semibold">{profileName ?? "Untitled"}</span>
        {dirty ? (
          <span className="inline-flex items-center gap-1 text-xs text-text-muted">
            <span aria-hidden="true" className="size-1.5 rounded-pill bg-dark" />
            Modified
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          title="Open profile (Ctrl+O)"
          onClick={() => dialogs.getState().showOpenProfile()}
        >
          Open…
        </Button>
        <Button
          size="sm"
          variant="outline"
          title="Save (Ctrl+S)"
          onClick={() => void controller.saveProfile()}
        >
          Save
        </Button>
        <Button
          size="sm"
          variant="outline"
          title="Save as (Ctrl+Shift+S)"
          onClick={() => void controller.openSaveAs()}
        >
          Save as…
        </Button>
      </div>

      <StatusPill variant={pill.variant} icon={pill.icon} label={pill.label} />

      <div className="ml-auto flex items-center gap-1.5">
        {can.connect ? (
          <SessionButton
            disabled={!ready || pending !== null}
            pending={pending === "connect"}
            title={`${state === "disconnected" ? "Reconnect" : "Connect"} (Ctrl+L)`}
            onClick={() => void controller.connect()}
          >
            {state === "disconnected" ? "Reconnect" : "Connect"}
          </SessionButton>
        ) : null}
        {can.cancel ? (
          <SessionButton
            disabled={!ready}
            variant="outline"
            pending={pending === "cancel"}
            title="Cancel (Ctrl+L)"
            onClick={() => void controller.cancelConnect()}
          >
            Cancel
          </SessionButton>
        ) : null}
        {can.disconnect ? (
          <SessionButton
            disabled={!ready}
            variant="outline"
            pending={pending === "disconnect"}
            title="Disconnect (Ctrl+L)"
            onClick={() => void controller.disconnect()}
          >
            Disconnect
          </SessionButton>
        ) : null}
        {state === "connected" ? (
          <SessionButton
            disabled={!ready}
            pending={pending === "startPoll"}
            title="Start polling (Ctrl+P)"
            onClick={() => void controller.startOrResume()}
          >
            Start polling
          </SessionButton>
        ) : null}
        {can.pause ? (
          <SessionButton
            disabled={!ready}
            variant="outline"
            pending={pending === "stopPoll"}
            title="Pause (Ctrl+P)"
            onClick={() => void controller.pause()}
          >
            Pause
          </SessionButton>
        ) : null}
        {state === "paused" ? (
          <SessionButton
            disabled={!ready}
            pending={pending === "startPoll"}
            title="Resume (Ctrl+P)"
            onClick={() => void controller.startOrResume()}
          >
            Resume
          </SessionButton>
        ) : null}
        {can.write ? (
          <Button
            size="sm"
            variant="outline"
            disabled={!ready}
            title="Write (Ctrl+E)"
            onClick={() => controller.openWrite()}
          >
            Write…
          </Button>
        ) : null}
      </div>
    </div>
  );
}
