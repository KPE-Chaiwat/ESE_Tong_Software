// The dialogs of closing and deleting a poll (S6, S7) and of closing the connection window, as views
// of a store: the connection window and a native poll window each have their own stores and show
// the same dialogs (DES-002 2.11). Each dialog holds a modal lock on its window's layout store, so
// the shortcuts are off and pop out, dock and the handoff answer know a dialog is open.
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { Button } from "@/shared/ui/button";
import { AlertDialog } from "@/shared/ui/dialog";
import { Checkbox, Label } from "@/shared/ui/input";
import type { LayoutStoreApi } from "../../store/layout.store";
import {
  CLOSE_TITLE,
  closeSnapshotText,
  DELETE_TITLE,
  DONT_ASK_AGAIN,
  deleteDialogBody,
  WINDOW_CLOSE_TITLE,
  windowCloseBody,
} from "../../store/poll-host.logic";
import { type PollHostStoreApi, selectCloseBody } from "../../store/poll-host.store";
import type { WindowCloseStoreApi } from "../../store/window-close.store";

/** Holds a modal lock on `layout` while the dialog is mounted. */
function useModalLockOn(layout: LayoutStoreApi): void {
  useEffect(() => layout.getState().lockModal(), [layout]);
}

/**
 * S6 Close poll window? (DES-002 2.11): Keep poll (default), Delete poll, Cancel.
 * The text is the snapshot the host store took when S6 opened (REPORT-004 CHK2-G6): a poll that
 * pauses, fails, is renamed or edited meanwhile does not change the sentence the user is reading.
 * `present` is whether the poll still exists; the buttons act on the poll as it is when pressed.
 */
export function ClosePollDialogView({
  host,
  layout,
  present,
}: {
  host: PollHostStoreApi;
  layout: LayoutStoreApi;
  present: boolean;
}) {
  const [dontAsk, setDontAsk] = useState(false);
  const body = useStore(host, selectCloseBody);
  useModalLockOn(layout);
  // The poll was deleted while the question was open (in another window): nothing left to ask.
  useEffect(() => {
    if (!present) host.getState().cancelClose();
  }, [present, host]);
  if (!present || !body) return null;
  return (
    <AlertDialog
      open
      title={CLOSE_TITLE}
      description={closeSnapshotText(body)}
      initialFocus='[data-default="true"]'
      onCancel={() => host.getState().cancelClose()}
      extra={
        <div className="flex items-center gap-2">
          <Checkbox
            id="dont-ask-again"
            checked={dontAsk}
            onChange={(e) => setDontAsk(e.target.checked)}
          />
          <Label htmlFor="dont-ask-again" className="font-normal">
            {DONT_ASK_AGAIN}
          </Label>
        </div>
      }
    >
      <Button
        type="button"
        data-default="true"
        onClick={() => void host.getState().confirmClose("keep", dontAsk)}
      >
        Keep poll
      </Button>
      <Button
        type="button"
        variant="destructive"
        onClick={() => void host.getState().confirmClose("delete", dontAsk)}
      >
        Delete poll
      </Button>
      <Button type="button" variant="outline" onClick={() => host.getState().cancelClose()}>
        Cancel
      </Button>
    </AlertDialog>
  );
}

/** S7 Delete poll? (DES-002 2.11): Cancel (default), Delete. */
export function DeletePollDialogView({
  host,
  layout,
  name,
}: {
  host: PollHostStoreApi;
  layout: LayoutStoreApi;
  name: string | null;
}) {
  useModalLockOn(layout);
  useEffect(() => {
    if (name === null) host.getState().cancelDelete();
  }, [name, host]);
  if (name === null) return null;
  return (
    <AlertDialog
      open
      title={DELETE_TITLE}
      description={deleteDialogBody(name)}
      initialFocus='[data-default="true"]'
      onCancel={() => host.getState().cancelDelete()}
    >
      <Button
        type="button"
        variant="outline"
        data-default="true"
        onClick={() => host.getState().cancelDelete()}
      >
        Cancel
      </Button>
      <Button
        type="button"
        variant="destructive"
        onClick={() => void host.getState().confirmDelete()}
      >
        Delete
      </Button>
    </AlertDialog>
  );
}

/** Save changes? (DES-002 2.11): Save (default), Don't save, Cancel. */
export function CloseWindowDialogView({
  store,
  layout,
}: {
  store: WindowCloseStoreApi;
  layout: LayoutStoreApi;
}) {
  const asking = useStore(store, (s) => s.asking);
  const saving = useStore(store, (s) => s.saving);
  const canSave = useStore(store, (s) => s.canSave);
  if (!asking) return null;
  return (
    <CloseWindowDialogBody
      store={store}
      layout={layout}
      text={windowCloseBody(asking)}
      saving={saving}
      canSave={canSave}
    />
  );
}

function CloseWindowDialogBody({
  store,
  layout,
  text,
  saving,
  canSave,
}: {
  store: WindowCloseStoreApi;
  layout: LayoutStoreApi;
  text: string;
  saving: boolean;
  canSave: boolean;
}) {
  useModalLockOn(layout);
  return (
    <AlertDialog
      open
      title={WINDOW_CLOSE_TITLE}
      description={text}
      initialFocus='[data-default="true"]'
      onCancel={() => store.getState().cancel()}
    >
      <Button
        type="button"
        disabled={!canSave || saving}
        data-default="true"
        onClick={() => void store.getState().save()}
      >
        Save
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={saving}
        onClick={() => store.getState().discard()}
      >
        Don't save
      </Button>
      <Button type="button" variant="outline" onClick={() => store.getState().cancel()}>
        Cancel
      </Button>
    </AlertDialog>
  );
}
