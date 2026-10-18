// Texts and rules of closing, deleting, popping out and docking a poll view, and of closing the
// connection window (DES-002 2.5, 2.11, 2.10.7). Pure.
import type { PollHostKind } from "@/shared/ipc/modbus-master.types";
import { saveChangesBody } from "./profile.logic";

export const CLOSE_TITLE = "Close poll window?";
export const CLOSE_UNAPPLIED = "Unapplied changes in the poll setup will be lost.";
/** Only said of a poll that is polling now (not paused, not offline; REPORT-003 O-2). */
export const CLOSE_ACTIVE = "A kept poll keeps polling in the background.";
export const DONT_ASK_AGAIN = "Don't ask again for this connection window";

/**
 * What S6 says, decided once when it opens (DES-002 2.11, revision 9): the poll's name and which of
 * the optional sentences apply. The text never changes while the dialog is open.
 */
export interface CloseSnapshot {
  name: string;
  /** "Unapplied changes in the poll setup will be lost." */
  unappliedSentence: boolean;
  /** "A kept poll keeps polling in the background." */
  keepsPollingSentence: boolean;
}

/**
 * The S6 snapshot. `polling` is whether the poll's STATE is running (polling, timeout, exception,
 * bad response): a poll that is paused or offline has nothing to keep running, even when its run
 * intent is on.
 */
export function closeSnapshot(
  name: string,
  details: { hasUnappliedEdits: boolean; polling: boolean },
): CloseSnapshot {
  return {
    name,
    unappliedSentence: details.hasUnappliedEdits,
    keepsPollingSentence: details.polling,
  };
}

/** S6 body: the question, then the sentences that apply (DES-002 2.11 table, in that order). */
export function closeSnapshotText(snapshot: CloseSnapshot): string {
  return [
    `Keep "${snapshot.name}" on this connection, or delete it?`,
    snapshot.unappliedSentence ? CLOSE_UNAPPLIED : null,
    snapshot.keepsPollingSentence ? CLOSE_ACTIVE : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" ");
}

export function closeDialogBody(
  name: string,
  details: { hasUnappliedEdits: boolean; polling: boolean },
): string {
  return closeSnapshotText(closeSnapshot(name, details));
}

export const DELETE_TITLE = "Delete poll?";

/** S7 body. */
export function deleteDialogBody(name: string): string {
  return `Delete "${name}"? Its window closes and its settings are removed from this connection.`;
}

// ---------------------------------------------------------------------------------------------
// Toasts and announcements of the host changes (DES-002 4, 2.10.8)
// ---------------------------------------------------------------------------------------------

export const popOutFailedToast = (message: string) => `Could not open the poll window: ${message}`;
export const dockFailedToast = (message: string) => `Could not dock the poll: ${message}`;
/** A list drag of a native poll was refused: a modal is open in its window (DES-002 2.10.7). */
export const handoffRefusedToast = (name: string) =>
  `Close the dialog in the "${name}" window first.`;

export const poppedOutAnnouncement = (name: string) => `${name} opened in its own window.`;
export const dockedAnnouncement = (name: string) => `${name} docked in the workspace.`;

/** Which host a poll is announced in after a change of `host` (or null when nothing is to say). */
export function hostChangeAnnouncement(
  name: string,
  before: { host: PollHostKind; open: boolean },
  after: { host: PollHostKind; open: boolean },
): string | null {
  if (!before.open || !after.open) return null;
  if (before.host === "native" && after.host === "workspace") return dockedAnnouncement(name);
  return null;
}

// ---------------------------------------------------------------------------------------------
// Closing the connection window W1 (DES-002 2.11)
// ---------------------------------------------------------------------------------------------

export const WINDOW_CLOSE_TITLE = "Save changes?";

export interface WindowCloseSummary {
  /** The profile name, null for an unnamed setup. */
  profileName: string | null;
  /** The profile has unsaved changes. */
  modified: boolean;
  /** Polls in their own windows: they close with W1. */
  nativeCount: number;
  /** Polls with unapplied setup edits in any host, in list order. */
  unappliedNames: readonly string[];
}

/** W1 asks before closing only with unsaved changes (the profile, or unapplied poll edits). */
export function needsWindowCloseConfirm(s: WindowCloseSummary): boolean {
  return s.modified || s.unappliedNames.length > 0;
}

/** "Save changes to "{name}" before closing?" plus the sentences that apply (DES-002 2.11). */
export function windowCloseBody(s: WindowCloseSummary): string {
  return saveChangesBody({
    profileName: s.profileName,
    nativeWindowCount: s.nativeCount,
    unappliedPollNames: s.unappliedNames,
    reason: "close",
  });
}

/** How a pop out or a dock was started: it decides where the focus goes if the command fails. */
export type CommandOrigin =
  | "button"
  | "shortcut"
  | "subWindowMenu"
  | "sidebarMenu"
  | "titleBarMenu"
  | "dragOut";

export type FocusTarget =
  | "button"
  | "previous"
  | "menuButton"
  | "sidebarRow"
  | "titleBar"
  | "pollName";

/**
 * Where the keyboard focus goes after a pop out or a dock failed (DES-002 2.5.2 step 5, 2.5.3 step
 * 4, 9): back to the control that started it. A menu returns it to its button, the sidebar menu to
 * its row; a drag has no control, so the title bar (a native window has no title bar: its poll
 * name, the toolbar). The caller falls back to `fallbackFocusTarget` when the element is gone.
 */
export function focusTargetAfterFailure(
  origin: CommandOrigin,
  host: "workspace" | "native",
): FocusTarget {
  switch (origin) {
    case "button":
      return "button";
    case "shortcut":
      return "previous";
    case "subWindowMenu":
      return "menuButton";
    case "sidebarMenu":
      return host === "workspace" ? "sidebarRow" : "pollName";
    case "titleBarMenu":
    case "dragOut":
      return host === "workspace" ? "titleBar" : "pollName";
  }
}

/** Where the focus goes when the element it should return to is gone. */
export const fallbackFocusTarget = (host: "workspace" | "native"): FocusTarget =>
  host === "workspace" ? "titleBar" : "pollName";
