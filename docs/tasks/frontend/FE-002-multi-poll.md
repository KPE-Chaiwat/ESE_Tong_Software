# FE-002 Multiple polls per connection - frontend tasks

**Revision 12 (2026-10-17): follow-ups after REPORT-008 (partial)** (DES-002 revision 12, D-002-36 and D-002-38; CHK-002 revision 12). One new task, **33**, below, for REPORT-008 open items D8b and D10. D-002-37 (D3 tolerance), D-002-39 (focus harness) and D-002-40 (layouts not installed) change only the checklist. Q-002-19 is closed by D-002-38.

### 33 Revision 12 follow-ups (REPORT-008)
Order: a, b. Each part is testable on its own.
- **a. Backslash shortcuts by physical key** (DES-002 3.1 "Backslash shortcuts", D-002-38; REPORT-008 defect D8b: Thai hardware `Ctrl+\` arrives as `key` "+", `code` "Backslash", and `punctuationKey()` returns "+", `shared/lib/shortcut-key.ts:62`).
  - **States:** every state where `Ctrl+\` or `Ctrl+Shift+\` is defined (W1 sidebar, SW scope, W2), on every layout. Off in modals, as before.
  - **Store unit (pure):** change `punctuationKey(e)` in `shared/lib/shortcut-key.ts` (same input shape as `shortcutKey`). Rules, in this order:
    - `isComposing` or `key` "Process": `null`;
    - `altGraph`, or `ctrlKey` and `altKey` both: `null` for the backslash result (any `code`);
    - `code` "Backslash": `"\\"` without Shift, `"|"` with Shift, whatever `key` is;
    - `key` "\\" or "|" (the layout's own backslash typed without AltGr, any `code`): that mark;
    - other ASCII marks: unchanged from revision 11.
  - **Vectors:** every backslash row of the CHK2-R12 table (US, Thai "+" / "ฅ" / "ฃ", German "#" / "'" and AltGr+ß, AZERTY "*" / "µ" and AltGr+8, Russian "\" / "/", UK `IntlBackslash`, Ctrl+Alt on `Backslash`, no Ctrl, "Process"). Plus: the letter and digit vectors of task 32 a still pass unchanged.
  - **Acceptance:** the vectors; a component test where `Ctrl` with (`key` "+", `code` "Backslash") toggles the setup in a sub-window and in the W2 host and collapses the W1 sidebar, and `Ctrl+Shift` with (`key` "ฅ", `code` "Backslash") toggles compact mode; Biome/TS clean; CHK2-R8, R12 (QA), M11 (owner).
- **b. W2 toolbar squeeze at the minimum** (DES-002 2.6 "Squeeze at the minimum", D-002-36; REPORT-008 open item D10: 3 toolbar rows, 1 grid row at 600 x 400 physical).
  - **States:** W2 in every connection and poll state, widths from 900 down to the minimum (465.6 css px at 125 %); W1 at its minimum (check only, labels kept).
  - **Components:** the W2 `NativeToolbar` (Pause/Resume, Write…, Connection window, Dock to workspace, `⋯`, poll name, pills); a shared icon-button variant in `shared/ui` if none exists (32 x 32, pill radius, 16 px icon, same tones and focus ring as the labelled button).
  - **Store unit (pure):** `toolbarLabelMode(clientWidthCss: number): "full" | "icon"`, threshold constant `TOOLBAR_ICON_ONLY_BELOW = 640` (one place, so QA can move it). Vectors: 900 -> "full"; 640 -> "full"; 639.9 -> "icon"; 465.6 -> "icon". The width source is the document `clientWidth` (the same source as the setup rail threshold).
  - In "icon" mode every listed button renders only its icon and has `aria-label` and `title` equal to its full name ("Pause" / "Resume", "Write…", "Connection window", "Dock to workspace"). The pills keep icon + text. The poll name truncates first (min 80 px) and gets its full text as `title` when cut (`useTruncationTitle`). The toolbar keeps `flex-wrap`, with the order of DES-002 2.6 (row 1 name, `✎`, state pill; row 2 connection pill, buttons, `⋯`).
  - **Acceptance:** the vectors; a component test that at a mocked width of 466 the four buttons have no visible text node and have the exact `aria-label` and `title`, and at 640 they show their text; the pills keep their text at 466; the focus order is unchanged between modes; CHK2-F17 (QA, real layout: at most 2 toolbar rows, at least 2 complete grid rows at the W2 and W1 minimum).

**Revision 11 (2026-10-17): follow-ups after REPORT-007** (DES-002 revision 11, D-002-31 to D-002-34; CHK-002 revision 11). One new task, **32**, below, for the REPORT-007 defects D8, D6, D7 and D9. D-002-28 to D-002-30 and D-002-35 change only the checklist; they need no frontend work. Open: Q-002-18 (who raises W1 for D7) and Q-002-19 (`Ctrl+\` on non-Latin layouts). Neither blocks task 32.

### 32 Revision 11 follow-ups (REPORT-007)
Order: a, b, c, d. Each part is testable on its own.
- **a. Shortcuts on every keyboard layout** (DES-002 3.1, D-002-31; REPORT-007 defect D8).
  - **States:** every state of every window (W1, W2, launcher) where a letter or digit shortcut is defined. Shortcuts stay off in modals, as before.
  - **Components:** one shared matcher in `shared/lib` (used by the launcher and every tool; a tool never imports from another tool). Replace every direct comparison of `e.key`. REPORT-007 names `tools/modbus-master/lib/shortcuts.ts:35` and `tools/modbus-master/components/sidebar/PollList.tsx:155`; search for others (`e.key.toLowerCase()`, `e.key ===` on a letter or digit).
  - **Store unit (pure):** `shortcutKey(e: { key: string; code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean; isComposing: boolean; altGraph: boolean }): string | null`. `altGraph` is `e.getModifierState("AltGraph")`. The function returns the normalized key ("p", "1", "F6", "ArrowRight", …) or `null`. The rules:
    - `isComposing`, or `key` "Process": `null`;
    - a letter or digit result with (`altGraph`) or (`ctrlKey` and `altKey`): `null`. Named keys keep `Ctrl+Alt+Arrow`;
    - `code` `Digit0`-`Digit9`: that digit (every layout); `key` "0"-"9": that digit (numeric keypad);
    - `key` is one ASCII letter: that letter, lowercased;
    - `key` is one non-ASCII character that is not `\p{Script=Latin}`, and `code` is `KeyA`-`KeyZ`: the letter from `code`;
    - any other single character (ASCII punctuation, a Latin letter with a diacritic): `null` for letter shortcuts;
    - named keys (`key.length > 1`): `key`.
  - Plus pure `isNativeTextEdit(target: { tagName: string; isContentEditable: boolean; type?: string }, k: string | null, e: { ctrlKey: boolean; shiftKey: boolean }): boolean`. It is true for `Ctrl+C/V/X/A/Z/Y` and `Ctrl+Shift+Z` in `input` (text, number, search, no type), `textarea` or a contenteditable. For those the shortcut layer returns early: no handler and no `preventDefault`.
  - **Vectors:** every row of the CHK2-R12 table, plus: ("P", KeyP, Ctrl+Shift) -> "p"; ("Dead", KeyP, Ctrl) -> `null`; ("ArrowRight", ArrowRight, Ctrl+Alt) -> "ArrowRight"; ("&", Digit1, Ctrl+Alt) -> `null`; `isNativeTextEdit` true for an `input` with ("a", Ctrl), false for the grid `div` with ("c", Ctrl).
  - **Acceptance:** the vectors; component tests where `Ctrl` with (`key` "ย", `code` "KeyP") pauses the focused poll in a sub-window and in the W2 host, and `Ctrl` with (`key` "&", `code` "Digit1") sets Unsigned; Biome/TS clean; CHK2-R8 to R12 (QA), M7 (owner).
- **b. No document scrollbar, one-line status bar** (DES-002 2.2.6, 2.6, D-002-32; REPORT-007 defect D6).
  - **States:** every W2, W1 and launcher state at every size down to the minimum, including the setup popover open, banners shown, and the toolbar wrapped.
  - **Components:** the window shells (W2 host, W1 shell, launcher): `html`, `body` and the root are exactly the viewport height with `overflow: hidden`, as a flex column. The PollView body and the data grid have `min-height: 0`, so the grid absorbs the height loss. The status bars (W1, W2) and `shared/ui/app-version`: status text `white-space: nowrap; flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis`; version label `white-space: nowrap; flex-shrink: 0`; bar height 28 px. The toolbar may wrap.
  - **Store unit:** no store state. A small hook `useTruncationTitle(ref, fullText)` sets `title` to the full text when `scrollWidth > clientWidth`, and removes it otherwise. Unit test it with mocked `scrollWidth` and `clientWidth`: (200, 100) -> `title` set; (100, 100) -> no `title`; a change of `fullText` updates the `title`.
  - **Acceptance:** the hook test; a component test that the status bar has the nowrap/ellipsis classes and that the root has no scrolling style; CHK2-F17 (QA, real layout: jsdom cannot check it).
- **c. "Show traffic for this poll" from a native window, W1 side** (DES-002 2.2.5, D-002-33; REPORT-007 defect D7).
  - **States:** traffic panel collapsed or expanded, any filter; W1 normal, minimized, behind other windows; a modal open in W1.
  - **Components:** the W1 traffic bar and panel, the Filter select, and the W2 `⋯` menu entry.
  - **Store unit:** the traffic store action `showTrafficFor(pollId: number, opts: { focusFilter: boolean })`. It sets `expanded = true` (the height is kept when already expanded), sets `filter = { kind: "poll", pollId }`, and sets `focusRequest = "filter"` when `opts.focusFilter` is true. The panel consumes `focusRequest` once: it focuses the Filter select unless a modal is open, in which case it waits until the modal closes and then clears the request. Vectors: collapsed -> expanded, filter set; expanded at height 300 -> height still 300; `focusFilter` false -> `focusRequest` stays `null`.
  - `focusFilter` is true when the request comes from a W2. Use the origin in the event payload if the backend sends one. If it does not, focus the Filter select when the W1 document did not have the focus as the request arrived. Raising and restoring W1 is Q-002-18 (assumption: the backend does it in `mm_show_traffic`). If the PM assigns it to the frontend, the W2 calls the existing "focus the connection window" IPC function (the one `Ctrl+Shift+M` uses) through `shared/ipc` before `mm_show_traffic`.
  - **Acceptance:** the vectors; a component test that the Filter select has the focus after `showTrafficFor(2, { focusFilter: true })`, and not while a modal is open; CHK2-K5 and K8 (b) (QA).
- **d. Focus after a failed pop out or dock** (DES-002 2.5.2 step 5, 2.5.3 step 4, 9; D-002-34; REPORT-007 defect D9).
  - **States:** pop out failure and dock failure, for every start path (button, shortcut, `⋯` menu, sidebar menu, title bar menu, drag out).
  - **Components:** the SW pop out button, the W2 [Dock to workspace] button, the menus, and the host lifecycle code of task 20.
  - **Store unit (pure):** `focusTargetAfterFailure(origin: "button" | "shortcut" | "subWindowMenu" | "sidebarMenu" | "titleBarMenu" | "dragOut", host: "workspace" | "native"): "button" | "previous" | "menuButton" | "sidebarRow" | "titleBar" | "pollName"`. Vectors: (button, workspace) -> `button`; (shortcut, workspace) -> `previous`; (subWindowMenu, workspace) -> `menuButton`; (sidebarMenu, workspace) -> `sidebarRow`; (titleBarMenu, workspace) -> `titleBar`; (dragOut, workspace) -> `titleBar`; (button, native) -> `button`; (shortcut, native) -> `previous`. The caller records the focused element before the command (for `previous`). If that element is gone, it uses the SW title bar (workspace) or the W2 toolbar poll name (native).
  - The pop out and dock buttons use `aria-busy="true"` and `aria-disabled="true"` while pending, never the `disabled` attribute. The error toast does not take the focus.
  - **Acceptance:** the vectors; a component test with the fake that fails the pop out: after the toast, `document.activeElement` is the pop out button (click) or the grid (shortcut), and never `BODY`; the same for a dock in the W2 host; CHK2-F8, F16 (QA).

**Revision 10 (2026-10-17): follow-ups after REPORT-006** (DES-002 revision 10, D-002-23, D-002-25, D-002-26; CHK-002 revision 10). One new task, **31**, below. Not frontend work (the PM carries them into BE-002):
- D-002-20 scan rate accuracy (defect D1);
- D-002-21 native minimum in physical px (D3);
- D-002-22 W1 work-area clamp (D5);
- the dev-only failure hook (Q-002-14, pending).

REPORT-006 D4 (CHK-003 [Apply scale] first click) and O5 (Modified flag lost after a webview reload) are not part of this revision.

### 31 Revision 10 follow-ups (REPORT-006)
Order: a, b, c, d. Each part is testable on its own.
- **a. Native setup popover below the threshold** (DES-002 2.3.3, 2.6, D-002-23; REPORT-006 O1).
  - **States:** setup rail, popover, panel in W2; compact on/off; live resize across 640; arrival by pop out with the setup open.
  - **Components:** the W2 host, `PollView`, `PollSetup`, the setup rail button, and the popover (reuse the sub-window popover component).
  - **Store unit:** the pure `setupPresentationFor` gains the native case. Its inputs are `host: "workspace" | "native"`, `widthPx` (W2: the PollView root's `offsetWidth`; workspace: the frame `offsetWidth`, unchanged), `open: boolean` (the per-poll setup open flag in the PollView store), and `compact: boolean` plus `localOverride: boolean`. It returns `"dock" | "popover" | "panel" | "rail" | "closed"`. Native vectors:

    | Inputs | Result |
    |---|---|
    | (639, open) | `popover` |
    | (639, closed) | `rail` |
    | (466, open) | `popover` |
    | (640, open, compact off) | `panel` |
    | (640, closed, compact on, no override) | `rail` |
    | (640, open, compact on, override) | `panel` |
    | (639, open, compact on, override) | `popover` |
    | (900, open) | `panel` |

    The popover open state **is** the `open` flag, so the handoff and a live resize keep it.
  - **Actions** (PollView store): `toggleSetup()` (rail click, `Ctrl+\`), `closeSetup()` (`Esc` inside the popover, [Done]).
  - **Layout:** the popover is 360 px wide at x = 30 (right of the rail), with its top under the status line and max height = client height - top - 8 px, scrolling inside. It does not close on an outside click. The rail button has `aria-expanded` and `aria-controls`. The popover has `role="dialog"`, `aria-modal="false"` and `aria-label="Poll setup"`. On open, focus goes to the first invalid field, otherwise Name; on close, focus returns to the rail button. The unapplied dot shows on the rail button.
  - **Acceptance:** the unit vectors above; a component test where a W2 with width 626 and an invalid Quantity "200" opens the popover with a rail click, shows the message, stays open after a click on the data card, and closes with `Esc` with focus back on the rail; a draft kept across 639 -> 640 -> 639; CHK2-F14.
- **b. Lone Alt never reaches the OS menu** (DES-002 3.1, D-002-25; REPORT-006 D2).
  - **States:** every window (W1, W2, launcher), idle or during a drag.
  - **Components:** one keyboard guard installed once per window by the app shell (`app/`), not per tool. The drag code keeps its own Alt handling (2.10.3).
  - **Store unit:** pure `createLoneAltTracker()` returning `{ keyDown(e: { key: string }): void; keyUp(e: { key: string }): boolean; blur(): void }`. `keyUp` returns true (call `preventDefault`) only for the Alt keyup that ends a press with no other key in between. Pointer events do not reset it.

    | Sequence | `keyUp` result |
    |---|---|
    | Alt down, Alt up | true |
    | Alt down, ArrowRight down/up, Alt up | false |
    | Alt down, F4 down | (not prevented: `Alt+F4` must still reach the OS and start the close-confirm flow) |
    | Alt down, Space down | false (`Alt+Space` keeps the OS menu) |
    | Alt down, window blur, Alt up | false |

  - The guard also calls `preventDefault` on that Alt keydown only when that is needed to stop WebView2 menu mode; record the finding.
  - **Acceptance:** the unit vectors; Biome/TS clean; CHK2-R7 with hardware input (QA). If CHK2-R7 still fails with the guard in place, report it in the implementation notes for the PM (Q-002-17: a window-layer fix). Do not touch `src-tauri` in this task.
- **c. "Save changes?" for loading** (DES-002 6.3, D-002-26 O7).
  - **States:** "Save changes?" before loading a profile, and before closing.
  - **Store unit:** pure `saveChangesBody({ profileName: string | null, nativeWindowCount: number, unappliedPollNames: string[], reason: "close" | "load" })` → string. Vectors:

    | Inputs | Result |
    |---|---|
    | (null, 1, ["Poll 2"], "load") | "Save this setup as a profile before loading? This also closes 1 poll window. Unapplied edits in: Poll 2." |
    | ("Plant", 0, [], "load") | "Save changes to "Plant" before loading?" |
    | (null, 2, ["Poll 3"], "close") | "Save this setup as a profile before closing? This also closes 2 poll windows. Unapplied edits in: Poll 3." (unchanged) |

  - The load flow passes `reason: "load"`.
  - **Acceptance:** the vectors; CHK2-N10.
- **d. QA hooks** for CHK2-F14 and F15:
  - the W2 setup host carries `data-presentation` (`panel` / `rail` / `popover`);
  - the pop out button has `aria-busy="true"` while its command is pending;
  - the W2 PollView keeps `data-ready` once the attach snapshot is applied.

**Revision 9 (2026-10-17): follow-ups after REPORT-004** (DES-002 revision 9, D-002-16 to D-002-19, CHK-002 revision 9). One new task, **30**, below. It supersedes task 29 b (thresholds) and corrects 29 a (width source) and 29 e (text snapshot). Task 30 is confirmed by the PM. The data card header freshness chip is unchanged by this task.

### 30 Revision 9 follow-ups (REPORT-004)
Order: a, b, c, d.
- **a. Status line steps 0..5** (DES-002 2.3.2, D-002-16). States: polling, waiting, timeout, exception, badResponse, paused, offline at every width. Components: `StatusLine`, `FreshnessSlot`, `ShowMenu`, the data card header chip. Store unit: pure `statusLineStep(lineWidthPx: number, freshness: "live" | "long" | "none"): 0 | 1 | 2 | 3 | 4 | 5`, thresholds T1 = 720 (`live`, `none`) / 810 (`long`), then 620, 606, 500, 465, strictly below = on; plus pure `counterText(c, step): { visible: string; full: string }` (`visible` drops `ID`/`F` at step ≥ 3 and `Err` at step 5; `full` is always complete). `freshness` is `long` for every non-"Updated" text (stale "… - values from …" and "Waiting for first response…"). `data-step` = the result. Layout: no spacer element; the reason is `flex: 1 1 0; min-width: 0`; the right group has `margin-left: auto`; chip, freshness chip, Show and `⋯` are `shrink-0`; the counters keep the end ellipsis with `title`/accessible name = `full` from step 3 on or when cut. The step result applies only to the freshness chip **inside the status line**; the data card header freshness chip (L ≥ 720) is **unchanged** and keeps its full text at every width (do not pass the step to it). At 720 ≤ L < 810 with a `long` text, `data-step` is 1 and nothing visible changes. Acceptance: unit vectors live 720 -> 0, 719 -> 1; long 810 -> 0, 809 -> 1; 620 -> 1, 619 -> 2; 606 -> 2, 605 -> 3; 500 -> 3, 499 -> 4; 465 -> 4, 464 -> 5; `none` 719 -> 1; `counterText` at steps 0, 3, 5 for `Tx 1234 · Err 3 · ID 1 · F 03 · SR 100 ms` and with `(effective 180 ms)`; component test: the header chip shows "No response - values from {time}" at L 720 and 809; CHK2-E16 to E26.
- **b. Setup threshold from the frame's `offsetWidth`** (DES-002 2.3.3, D-002-17). States: setup dock / popover, active and inactive frames. Components: `SubWindowFrame`, `PollView`. Store unit: pure `setupPresentationFor(host, frameWidthPx, open)` unchanged in shape; the caller passes the frame element's measured `offsetWidth` (ResizeObserver `borderBoxSize` inline size, rounded the same way), never the body width + `frameInset`. Remove `frameInset`. Acceptance: vectors 640 -> dock, 639 -> popover; component test: A at 639 with the popover stays a popover when B is activated (CHK2-E12 inactive cases).
- **c. S6 body snapshot** (DES-002 2.11, D-002-18). States: S6 open over any poll state. Components: the S6 dialog in both hosts. Store unit: the S6 text builder in `store/poll-host.logic.ts` is called **once** when S6 opens; the dialog stores `{ name, unappliedSentence: boolean, keepsPollingSentence: boolean }` in its open state (e.g. `closeDialog: { pollId; body } | null`) and renders from it; the buttons read the live poll state when pressed. Acceptance: store test: open S6 with Polling, change the poll to Paused, the stored body still has `keepsPollingSentence: true`; close and reopen: `false` (CHK2-G6 snapshot items).
- **d. QA hooks:** keep `data-step` on the status line and expose the counters element (`data-slot="counters"`) and the reason element (`data-slot="reason"`) so QA can measure `scrollWidth`/`clientWidth` (CHK2-E26). The fake must allow freezing `Tx` and `Err` (reference content `Tx 1234`, `Err 0` / `Err 3`).

**Revision 8 (2026-10-17): follow-ups after REPORT-003** (DES-002 revision 8, D-002-07 to D-002-15, CHK-002 revision 8). Q-FE2-16 is closed (D-002-08). One new task, **29**, below; the other tasks are unchanged.

### 29 Revision 8 follow-ups (REPORT-003)
Each sub-task is small and testable on its own. Order: a, b, c, d, e, f, g.
- **a. Dock threshold on the frame width** (DES-002 2.3.3, D-002-07). States: PV setup presentation. Components: `SubWindowFrame`, `PollView`. Store unit: pure `setupPresentationFor(host, widthPx, open)` where, for `host = "workspace"`, `widthPx` is the **frame** rectangle width from `workspaceStore` (`item.rect.width`), not the measured PV width; W2 unchanged. Acceptance: vectors 640 -> dock, 639 -> popover, 600 -> popover, 900 -> dock, maximized uses the maximized width; a new poll at 640 x 368 opens with the dock; a draft survives a 640 -> 639 resize (CHK2-B1, E12).
- **b. Status line steps** (DES-002 2.3.2, D-002-13). States: polling, timeout, exception, badResponse, offline, paused, at narrow widths. Components: `StatusLine`, `FreshnessSlot`, `ShowMenu`. Store unit: pure `statusLineSteps(lineWidthPx): { freshnessIconOnly: boolean; reasonHidden: boolean; idsHidden: boolean; showIconOnly: boolean }` with the thresholds 700, 620, 580, 480 (strictly below = on), driven by the PV's measured width (the PV already measures it for `isWideHeader`), so the steps are unit-testable instead of container queries. The counters span gets `min-width: 0` + ellipsis + its full text as `title` (final safety); the chip, freshness chip, Show and `⋯` are `shrink-0`. Acceptance: vectors 719/700 (text), 699 (icon), 620/619, 580/579, 480/479; CHK2-E16 to E19 fit check (no overflow, `⋯` inside). Replaces the part A decision 6 widths (430/560).
- **c. Tab into a sub-window activates it** (DES-002 2.3.1, 9, D-002-08). States: workspace normal/maximized. Components: `SubWindowFrame` (`onFocusCapture` -> `workspace.activate(pollId)` when it is not already active). Store unit: `workspaceStore.activate(id)` (existing; does not report). Acceptance: DOM order stays by poll id; the focused element keeps the focus after the raise; `aria-current` moves; no `mm_set_workspace_layout` for a pure activation (CHK2-R1, R6, N9). `Ctrl+F6` keeps list order with wrap and skips minimized (already built, B1 decision 3; CHK2-E9).
- **d. Snap tie rule** (DES-002 2.10.3, D-002-10). States: drag (move, resize, keyboard snap). Store unit: pure `snapRect` in `lib/drag-math.ts`: ties ordered tile-area edge, then touching edge (offset 0) before gap line (offset 8), then higher z. Acceptance: the CHK2-I22 table as unit vectors (dx 260, 266, 275, 276, 277, 284; Alt -> no snap).
- **e. S6 keeps-polling sentence by state** (DES-002 2.11, D-002-09). States: S6 over polling, waiting, timeout, exception, badResponse (sentence) and paused, offline (no sentence). Store unit: the S6 text builder in `store/poll-host.logic.ts` takes the `PollState` (not `active`). Acceptance: the CHK2-G6 table as unit vectors, in both hosts.
- **f. Duplicate state and title** (D-002-11, D-002-12): no UI change expected; check the fake follows `active = autoStartPoll` for a duplicate (CHK2-B5) and the title has " *" when Modified (CHK2-C2).
- **g. Not a design change, but needed for CHK2-F1/F2:** the effect in `DataGrid.tsx` that scrolls the focused row into view must not override the restored `topAddress` of a handoff (REPORT-003 finding 1). Acceptance: the handoff `{"topAddress":2,"selection":[{"start":3,"end":5}],"anchorAddress":3,"focusAddress":5}` shows address 2 as the first visible row after pop out and after dock.
- Also intended behavior, nothing to build (D-002-14): zones suspend edge snapping (O-4); z-order reported at the next layout action, Save flushes (O-5); Write… with the link down does nothing (O-6); Disconnected announced assertively (O-8). D-002-15 is a QA measurement rule only.

**Revision 6 (2026-10-16): hybrid model.** Restructured for DES-002 revision 6: the workspace (sub-windows in the connection window) is the default host, polls can be popped out to native windows and docked back, there is **one shared PollView component** used by both hosts, plus aliases, Window/Arrange menus, compact mode and drag and drop. Old tasks are mapped in the "Superseded" table. Task numbers changed.

Upstream: `docs/design/DES-002-multi-poll.md` revision 6 (DES-002), DES-003 revision 6, DES-001 rev 4, BE-001 Final contract, BE-002 (written by the PM from DES-002 section 8). QA: `docs/qa/CHK-002-multi-poll.md`.
Builds on the FE-001 code and its "Implementation notes": the runtime/controller pattern, hand-built ARIA grids, the own toast store, and the fake IPC with `VITE_FAKE_IPC`.

## Ground rules
- **State ownership:** connection state, poll states, definitions, `active`, view settings (display, scale, aliases), hosts and stored layout live in Rust (CLAUDE.md rule 6). Stores mirror backend events and snapshots. Only drafts, selection, scroll, drag state and transient UI state are local.
- **IPC:** stores never import `@tauri-apps/api`. They call the `shared/ipc` facade. Stores are factories (`createXStore(deps)`) tested with the fake.
- **Two window kinds, one PollView:**
  - `connectionRuntime` (W1, route `/tools/modbus-master`) owns the sidebar, workspace, traffic, and **one `pollViewRuntime` per workspace sub-window**.
  - `nativePollRuntime` (W2, route `/tools/modbus-master/poll`) owns exactly one `pollViewRuntime`.
  - `pollViewRuntime(pollId, host)` creates the per-view stores (tasks 07-09), attaches the view channel and is disposed on unmount or `ViewDetached`. The `PollView` component (task 11) receives only that runtime and a `host` prop; it never knows which window it is in except through that prop.
  - Neither window kind imports the other. Shared pieces stay inside `tools/modbus-master/` or go to `shared/`.
- **Strings:** English, copied exactly from DES-002/DES-003 (and DES-001 where reused).
- **Contract switch:** the fake implements DES-002 section 8 (revision 6) before BE-002 lands. Temporary local types are marked `TEMP until BE-002 bindings`. Task 01 owns this.
- **Drag implementation choice (PM decides, task 15):** pointer events written directly, or a small library. Trade-offs are listed in task 15. Every drag behavior is specified as pure functions (tasks 03-04) so the choice does not change the tests.

## The two state machines (used by tasks 05-07)
```
ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected'
PollState       = 'offline' | 'paused' | 'polling' | 'timeout' | 'exception' | 'badResponse'
PollHostState   = 'workspace.normal' | 'workspace.minimized' | 'workspace.maximized' | 'native' | 'closed'
P* = polling | timeout | exception | badResponse
```
`CONNECTION_ALLOWED` (DES-002 1.3, C1-C7):

| From | Allowed next |
|---|---|
| idle | connecting |
| connecting | connected, disconnected, idle |
| connected | idle, disconnected |
| disconnected | connecting, idle |

`POLL_ALLOWED` (DES-002 1.4, PT0-PT8):

| From | Allowed next |
|---|---|
| offline | paused, polling |
| paused | polling, offline |
| polling, timeout, exception, badResponse | polling, timeout, exception, badResponse, paused, offline |

`HOST_ALLOWED` (DES-002 2.5.1, H1-H17): workspace.* <-> each other; workspace.* -> native, closed; native -> workspace.normal, closed; closed -> workspace.normal, native. Unexpected pairs are applied anyway and recorded in `lastUnexpected` (development warning), as in FE-001.

## Superseded (old revision 5 task -> new task)
| Old | New | Note |
|---|---|---|
| 01 IPC facade v2 | 01 | attach/detach, host, pop out, dock, arrange, monitors, reorder, layout, aliases added |
| 02 Pure utils | 02, 03 | placement split into layout math (03) |
| 03 Connection store | 05 | unchanged content |
| 04 Poll list store | 06 | `windowOpen` replaced by host fields; reorder added |
| 05 Poll store (W2) | 07 | now per view, multi-instance in W1 |
| 06 Poll data store | 08 | per view |
| 07 Traffic store v2 | 10 | unchanged content |
| 08 Connection window shell | 17 | new layout |
| 09 Poll list UI | 18 | sidebar list |
| 10 Poll window shell | 11 (PollView) + 19 (native host) | |
| 11 Window lifecycle | 20 | host lifecycle |
| 12 Write | 22 | |
| 13 Profiles v2 | 23 | |
| 14 Shortcut maps | 24 | per host |
| 15 Traffic filter UI | 25 | traffic bar added |
| 16 Performance and accessibility | 28 | 8 sub-windows and drag added |

---

## Tasks (ordered; each is independently testable)

### 01 IPC facade v3 and fake
- **Goal:**
  - Facade functions for every DES-002 8.2 command: `openSession`, `attachPollView(pollId, host, onEvent)` (returns snapshot + `viewToken`), `detachPollView(pollId, viewToken)`, `addPoll(input, host)`, `duplicatePoll`, `removePoll`, `updatePoll`, `renamePoll`, `reorderPolls(order)`, `setPollActive`, `setAllPollsActive`, `setAutoStartPoll`, `setPollView` (with `aliases`), `write`, `resetCounters(pollId?)`, `showPoll(pollId, placement?)`, `popOutPoll(pollId, anchor, handoff)`, `dockPoll(pollId, handoff, requestHandoff, rect?)`, `provideHandoff`, `closePollView(pollId, keep)`, `showPollWindows`, `focusConnectionWindow`, `setWorkspaceLayout`, `setCompactMode`, `setAskOnPollClose`, `arrangePollWindows(layout, target)`, `applyProfile`, `exportProfile`, `setProfileName`, `requestSave`, `showTraffic`. In `shared/ipc/window.ts`: `listMonitors()`.
  - Event types: `SessionEvent` v2 (+ `RevealPoll`, `PrefsChanged`), `PollViewEvent` (+ `ViewDetached`, `HandoffRequested`).
  - Fake: N polls with the DES-002 7 scheduler simulation; per-poll fault scripting; per-view routing table with view tokens (at most one view per poll, replacement sends `ViewDetached { reason: "replaced" }`); host model H1-H17; one-shot handoff storage (10 s expiry); arrange computed with task 03 functions over a scripted monitor list; reorder validation.
- **States:** transport for all; host states.
- **Store:** none.
- **Acceptance (Vitest):**
  - Revision 5 scheduler tests still pass (no overlap, no starvation, writes first, timeouts isolated).
  - Two views attached to two polls receive only their own `PollUpdate` and `PollStateChanged`.
  - Attaching a second view for the same poll sends `ViewDetached { reason: "replaced" }` to the first; a late `detachPollView` with the old token leaves the new view attached.
  - `popOutPoll` then `attachPollView(pollId, 'native')` returns the handoff once; a second attach returns `handoff: null`.
  - `attachPollView(pollId, 'workspace')` for a native poll rejects with `validation`, `field: "host"`.
  - `reorderPolls` with a non-permutation rejects with `field: "order"`.
  - No module outside `shared/ipc` imports `@tauri-apps/api`.

### 02 Pure utils: summary, names, titles, status line, alias rules
- **Goal:** pure functions:
  - `pollSummary(polls)`, `nextPollName`, `duplicateName`, `pollNameSchema(existing)` (revision 5, unchanged)
  - `connectionTitle(...)`, `nativePollTitle(...)` (DES-002 2.12), `subWindowLabel(name, pill)` ("{name}, {pill}, sub-window")
  - `statusLineText(counters, slaveId, fc, scanMs, effectiveScanMs)` -> `"Tx 1204 · Err 0 · ID 1 · F 03 · SR 100 ms"` and the effective variant; `statusLineReason(pollState, connectionState, details)` -> `{ text, tone }` (DES-002 2.3.2 table)
  - `compactChipLabel(state, details)` ("Live", "Paused", "Timeout 3", "Exc 02", "Bad response", "Offline", "Waiting")
  - `hostMarker(host)` -> `{ icon, text } | null`
  - `aliasSchema()` (DES-002 4 alias rows, first failing rule only), `parseAliasPaste(text, startAddress, endAddress)` -> `{ entries, skipped, beyond }`
  - `restorePlacement(saved, monitors, fallback)` (2.13, unchanged)
- **States:** summary rules for all `PollState` values; status line for every poll and connection state.
- **Store:** none.
- **Acceptance (Vitest, table-driven):**
  - revision 5 cases still pass
  - `statusLineText` with errors 2 and timeouts 4 gives `Err 6`; FC 3 gives `F 03`; effective 140 at scan 100 gives `SR 100 ms (effective 140 ms)`
  - `statusLineReason('timeout', 'connected', {timeoutMs: 1000})` gives "No response within 1000 ms" with tone warning; offline + disconnected gives "No connection: link lost" with tone error
  - `aliasSchema`: 33 characters -> "Alias must be at most 32 characters."; " a" -> "Alias cannot start or end with a space."; "a\tb" -> "Alias cannot contain control characters."; "   " -> valid (removes the alias)
  - `parseAliasPaste("A\nB\n\nC\tx\n", 8, 9)` gives entries 8 "A", 9 "B" and beyond 2 (the empty line and "C" are past 9)

### 03 Layout math (pure)
- **Goal:** pure functions used by the workspace and by the fake's native arrange (the backend implements the same rules for natives):
  - `tileRects(n, area, gap, min)` -> `{ rects, overflow }` (DES-002 2.8.1 steps 1-8)
  - `sideBySideRects`, `stackedRects` (2.8.2, 2.8.3), `cascadeRects(n, area, min, defaultSize)` (2.8.4)
  - `nextSlot(k, area, defaultSize)` (2.4 new sub-window placement)
  - `clampRect(rect, workspaceSize)` (2.10.1: 80 x 30 px of the title bar stays inside), `clampMin(rect, min)`
  - `groupByMonitor(windows, monitors)` (2.8.5 each-monitor target)
- **States:** none (math).
- **Store:** none.
- **Acceptance (Vitest):** every test vector WT-1..WT-4 and NT-1..NT-3 from DES-002 2.8.1, exactly; cascade of 12 windows puts window 10 at (A.x + 240, A.y); `clampRect` of a 640-wide rect at x = -600 in a 1316-wide workspace returns x = -560; overflow counts are exact.

### 04 Drag math (pure)
- **Goal:** pure functions for every drag rule in DES-002 2.10, with no DOM access:
  - `moveRect(start, pointerDelta)`, `resizeRect(start, edges, delta, min)` (opposite edge fixed)
  - `snapRect(rect, movingEdges, candidates, threshold = 8)` -> `{ rect, guides: Guide[] }` (candidates = tile-area edges + other windows' edges and edges offset by the 8px gap; ties: workspace edge first, then higher z)
  - `snapZoneAt(pointer, area, margin = 24)` -> `'left' | 'right' | 'full' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' | null`, `zoneRect(zone, area, gap = 8)`
  - `swapTargetAt(pointer, titleBars, selfId)` -> `PollId | null`
  - `tileSlotAt(pointer, slotRects)` -> index; `insertAt(order, id, index)`
  - `listInsertIndex(pointerY, rowRects)` -> gap index; `reorder(list, from, to)`
  - `neighborInDirection(activeRect, others, dir)` (center within a 90° cone, smallest distance), `adjacentSlot(index, cols, n, dir)`
  - `popOutModeFor(pointer, workspaceRect, clientRect, threshold = 48)` -> boolean
  - `restoreFromMaximizedForDrag(normalRect, pointer, titleBarWidth)` (keeps the pointer's relative x)
- **States:** drag (move, resize, snap, zone, swap, tile reorder, list reorder, pop-out mode).
- **Store:** none.
- **Acceptance (Vitest):**
  - a rect whose left edge is 7 px from another window's right edge + 8 snaps to it with one vertical guide; at 9 px it does not snap
  - pointer at (A.x + 10, A.y + 300) gives `left`; at (A.x + 10, A.y + 10) gives `topLeft`; at bottom edge (not a corner) gives `null`
  - `zoneRect('right', A=(8,8,1316,700))` gives (670, 8, 654, 700)
  - `resizeRect` below 320 x 180 clamps to the minimum with the opposite edge fixed
  - `neighborInDirection` picks the closer of two windows to the right, and ignores a window that is mostly below
  - `popOutModeFor` is false at 47 px outside the workspace and true at 49 px or outside the client area

### 05 Connection store (W1 and every view)
- Unchanged from revision 5 task 03 (`connectionStore`, C1-C7, banner and pill helpers; `disconnect` not exposed to the native host). One instance per window; in W1 the PollViews read the W1 instance through the view runtime (the view channel's `ConnectionStateChanged` is applied to the same store, idempotently).
- **Acceptance:** revision 5 task 03 acceptance, plus: applying the same `ConnectionStateChanged` from the session channel and from a view channel leaves one transition (no duplicate announcement).

### 06 Poll list store (W1)
- **Goal:** mirror all polls for the sidebar, the summary chip, the Window menu, the traffic filter names, tile order and close confirms.
- **States:** all `PollState` values; host states (markers).
- **Store unit:** `pollListStore`
  ```
  state: {
    order: PollId[]                                   // list order from Rust
    polls: Record<PollId, {
      config: PollConfig; state: PollState; consecutiveFailures: number;
      exceptionCode: number | null; badResponseKind: BadResponseKind | null; badResponseDetail: BadResponseDetail | null;
      lastOkAt: number | null; host: PollHostKind; open: boolean; workspace: WorkspaceRect | null;
      hasUnappliedEdits: boolean; counters: PollCounters
    }>
    selectedId: PollId | null
    pending: Record<PollId, null | 'active' | 'rename' | 'remove' | 'show' | 'reorder'>
    adding: boolean
    renamingId: PollId | null
  }
  derived: summary, canAdd (order.length < 16), anyRunning, anyPaused, unappliedNames (list order),
           hostState(id): PollHostState, nativeCount
  actions:
    applySnapshot(s), applyPollListChanged(evt), applyPollStateChanged(evt), applyCounters(evt),
    select(id), add() /* ipc.addPoll(defaults, 'workspace') */, duplicate(id), rename(id, name),
    remove(id), setActive(id, b), setAllActive(b),
    reorder(fromIndex, toIndex) /* optimistic, ipc.reorderPolls, rollback on error */, moveUp(id), moveDown(id)
  ```
- **Acceptance (Vitest):**
  - revision 5 task 04 acceptance (reference stability, 16 limit, duplicate name, selection after remove)
  - `reorder(0, 2)` on [A, B, C] gives [B, C, A] immediately and calls `reorderPolls([B, C, A])` once; a rejected call restores [A, B, C] and shows the rejection toast
  - `moveUp` on the first row does nothing and makes no IPC call
  - `hostState` returns `closed` when `open` is false, `workspace.minimized` when the rect state is minimized

### 07 Poll view runtime and poll store (per view, multi-instance)
- **Goal:** one runtime per poll view, usable many times in one webview (W1) and once in W2. It attaches the view channel, holds events until the snapshot (FE-001 rule), applies the handoff once, and disposes on unmount or `ViewDetached`.
- **States:** offline, paused, polling, timeout, exception, badResponse (PT0-PT8); PV loading (attach) before the snapshot; removed; detached.
- **Store units:**
  ```
  pollStore (per view)
  state: {
    pollId: PollId; host: PollHostKind; viewToken: ViewToken | null
    attach: 'attaching' | 'attached' | 'detached'
    config: PollConfig | null; state: PollState
    consecutiveFailures, exceptionCode, badResponseKind, badResponseDetail, lastOkAt,
    counters: PollCounters; effectiveScanMs: number | null
    pending: null | 'apply' | 'active' | 'rename' | 'popOut' | 'dock'
    removed: boolean; lastUnexpected: { from; to } | null
  }
  actions:
    init() /* attachPollView(pollId, host) */, dispose() /* detachPollView with own token */,
    applyPollStateChanged, applyPollConfigChanged, applyCounters, applyPollUpdateMeta,
    applyViewDetached(reason), apply(definition), setActive(b), rename(name), setView(partial),
    reportUnappliedEdits(b)
  pure helpers: isAllowedPoll(from,to), pollPillFor(state, code), pollBannerFor(...)

  pollViewUiStore (per view, local only)
  state: {
    setupOpen: boolean; setupOverride: boolean      // local override of compact mode
    selection: Array<{ start: number; end: number }> // protocol addresses
    focusAddress: number | null; topAddress: number | null
    columnWidths: Record<'alias'|'address'|'raw'|'scaled', number>
    pollDraft: PollSetupDraft | null; scaleDraft: ScaleDraft | null   // drafts survive presentation changes
  }
  actions: toggleSetup(), setSelection(...), setScrollTop(addr), setColumnWidth(...),
           setPollDraft(d), setScaleDraft(d), toHandoff(): string /* PollViewHandoffV1 JSON */,
           applyHandoff(json) /* zod-validated, ignores invalid */
  ```
- **Acceptance (Vitest):**
  - two `pollStore` instances in one test, for two polls on one fake connection, change independently
  - events received before the snapshot are applied after it, in order
  - `ViewDetached` sets `attach = 'detached'` and stops applying events; `dispose()` after that does not call detach with a foreign token
  - `toHandoff` then `applyHandoff` round-trips selection, focus, top address, widths, setupOpen and both drafts (including invalid field text) deep-equal; an invalid JSON is ignored without throwing
  - revision 5 task 05 acceptance (PT1-PT8, rename from elsewhere keeps the draft, effective rate rule)

### 08 Poll data store per view
- Revision 5 task 06, per view: `pollDataStore` with `pollId`; wiring from `pollStore.state` (`begin`, `markStale`, `clear`); offline texts by host ("Not connected. Connect from the toolbar (Ctrl+L)." in the workspace, "Not connected. Connect from the connection window (Ctrl+Shift+M)." in W2); the attach snapshot's `lastUpdate` seeds the values, so a moved view shows values at once.
- **States:** empty data, loading, live, stale (incl. offline).
- **Acceptance:** updates for another `pollId` are ignored; a view attached with `lastUpdate` renders live values without passing through loading; offline texts per host exactly.

### 09 Alias store (per view)
- **Goal:** mirror the poll's applied aliases and run the inline editor and paste.
- **States:** alias invalid input; empty (no alias).
- **Store unit:** `aliasStore`
  ```
  state: {
    aliases: ReadonlyMap<number, string>        // applied, from PollConfig.aliases
    editing: { address: number; text: string; error: string | null; startedBy: 'f2' | 'dblclick' | 'menu' } | null
    pending: boolean
  }
  derived: aliasAt(address), countTotal
  actions:
    applyFromConfig(config), beginEdit(address, by), setText(t) /* aliasSchema per keystroke */,
    commit(): 'next' | 'prev' | 'end' | 'invalid' , cancel(),
    clear(addresses[]), paste(text, startAddress, endAddress) /* parseAliasPaste, cap 2000, one setPollView */
  ```
- **Acceptance (Vitest):**
  - commit of "Tank top" at address 0 calls `setPollView` once with `aliases` containing `{0, "Tank top"}` and marks nothing else
  - commit of "   " removes the alias; an invalid text returns `'invalid'` and makes no IPC call
  - after `applyFromConfig` with start changed from 0 to 5, `aliasAt(0)` is still "Tank top" (aliases follow the address)
  - paste at the cap reports "Pasted {n} aliases. The poll has reached 2000 aliases."
  - the paste toast text for 3 pasted, 1 invalid, 2 beyond is "Pasted 3 aliases. Skipped 1 invalid lines. 2 lines were beyond the poll range."

### 10 Traffic store v2
- Revision 5 task 07 unchanged (`trafficStore` with `filter`, per-poll counters, visible frames), plus the first filter label "All polls" and filter entries in list order (re-sorted on `PollListChanged`).
- **Acceptance:** revision 5 task 07 acceptance; after `reorder`, the filter entries follow the new order.

### 11 PollView component (shared by both hosts)
- **Goal:** one `PollView` for SW and W2 (DES-002 2.3.2-2.3.6):
  - status line: chip, `statusLineText`, reason with tone and tooltip (full banner text), Show control, `⋯` menu (host-specific last items: Pop out vs Dock), responsive hiding order
  - setup presentation by `host` and width: panel / rail (W2), dock / popover (SW); popover not light-dismissed; [Done]; unapplied dot on `⚙`
  - data card: wide header (segmented controls) at ≥ 720px, compact "Show ▾" menu below; Alias | Address | Raw | Scaled columns; empty/loading/live/stale texts; "Loading poll…" before the snapshot
  - container queries via `ResizeObserver` coalesced per animation frame
- **States:** every poll state, connection states shown in a view, PV loading (attach), empty data, invalid input (setup).
- **Store:** `pollStore`, `pollViewUiStore`, `pollDataStore`, `aliasStore`, `connectionStore`, `tableSelectionStore` (FE-001).
- **Acceptance (Testing Library + fake, each case rendered with `host="workspace"` and `host="native"`):**
  - timeout: chip "Timeout", text `Tx … · Err … · ID 5 · F 03 · SR 100 ms`, reason "No response within 1000 ms", the line has the warning tone class, tooltip has the DES-001 banner text
  - at width 600 the setup opens as a popover in the workspace host and the "Show ▾" menu replaces the segmented controls; at 900 it opens as a dock
  - closing and reopening the popover keeps an invalid Quantity draft and its message
  - with `showAlias` off the Alias column is absent; the header order is Alias, Address, Raw, Scaled

### 12 Alias editing UI, paste and copy with alias
- **Goal:** DES-002 2.3.5 and DES-003 3.4 revision 6: double-click / `F2` / menu "Edit alias (F2)"; `Enter`, `Shift+Enter`, `Tab`, `Esc`, blur rules; floating FieldMessage; "Clear alias"; `Ctrl+V` and "Paste aliases"; "Include alias in copy" checkbox; "Copy aliases".
- **States:** invalid input (alias), empty data (no alias placeholder on the focused row).
- **Store:** `aliasStore`, `pollViewUiStore`, `pollStore.setView` (copyAlias, showAlias).
- **Acceptance (Testing Library):**
  - typing 33 characters shows "Alias must be at most 32 characters." and `Enter` does nothing
  - `Enter` on a valid alias opens the next row's editor; `Esc` restores the previous text
  - `Ctrl+V` with "A\nB" on row 8 sets aliases 8 and 9 and shows "Pasted 2 aliases."
  - with "Include alias in copy" on, `Ctrl+C` on rows 0-1 (Both, 4-20 mA) gives "PT-201\t0\t0\t4.00\n\t1\t65535\t20.00"

### 13 Workspace store and sub-window frame (no drag yet)
- **Goal:** the workspace area, sub-window frames with title bar buttons, activation and z-order, minimize / maximize / restore / close (S6 trigger), minimized bar, empty texts, `Ctrl+F6` cycling, new sub-window placement (`nextSlot`), clamping on W1 resize, layout reporting at action end.
- **States:** host workspace.normal / minimized / maximized; empty workspace texts.
- **Store unit:** `workspaceStore` (W1)
  ```
  state: {
    items: Record<PollId, { rect: Rect; z: number; state: SubWindowState; restore: Rect | null }>
    activeId: PollId | null
    minimizedOrder: PollId[]
    tileMode: boolean
    size: { w: number; h: number }               // workspace inner size
    sidebar: { width: number; collapsed: boolean }
    traffic: { expanded: boolean; height: number | null }
    nextZ: number
  }
  derived: visibleIds (non-minimized, z order), tileArea (minus padding and minimized bar)
  actions:
    applyLayout(layout) /* snapshot */, mount(id, rect?), unmount(id), activate(id),
    setRect(id, rect) /* commit; clamp */, minimize(id), maximize(id), restore(id),
    minimizeAll(), restoreAll(), arrangeMinimized(listOrder), cycle(dir),
    setSize(size) /* clamp all; re-tile when tileMode */, setSidebar(...), setTraffic(...),
    toLayout(): WorkspaceLayout, flush() /* setWorkspaceLayout, called at action end only */
  ```
- **Acceptance (Vitest + Testing Library):**
  - `activate` raises z to the top and sets `aria-current` on that frame only
  - minimizing the active window activates the next one by z-order; the minimized bar shows "Minimized" and the pill "{name} · {chip}"
  - while one window is maximized, activating another shows it maximized and restores the first to its previous rect
  - `setSize` smaller clamps a rect so 80 x 30 px of its title bar stays inside
  - `flush` is called once per action, never during `setRect` from a drag (spy)
  - empty texts per DES-002 2.2.4 exactly

### 14 Window menu, Tile, Cascade and tile mode (no drag yet)
- **Goal:** M1 (DES-002 2.7) with enabled rules and entries in list order with markers; Tile (`tileRects`) turns tile mode on; Cascade turns it off; the "Tile mode" checkbox; re-tiling on add, remove, close, pop out, minimize, restore, reorder, resize; overflow toast; Arrange minimized; Minimize all; Restore all; the "Tile mode" corner indicator.
- **States:** tile mode on/off.
- **Store:** `workspaceStore`, `pollListStore`.
- **Acceptance (Testing Library):**
  - 4 sub-windows in a 1332 x 716 workspace (inner tile area 1316 x 700): Tile gives the WT-1 rectangles
  - with tile mode on, closing one (Keep) re-tiles the remaining 3 to WT-2
  - Cascade unchecks Tile mode
  - 13 sub-windows: toast "1 window did not fit and was cascaded."
  - Popped-out windows ▸ disabled with title "No poll is open in its own window." when none

### 15 Drag: move, resize, snapping, zones, swap, Esc, keyboard equivalents (free layout)
- **Goal:** DES-002 2.10.1-2.10.4 and 2.10.8 for workspace sub-windows: press-to-raise; 4 px threshold; transform-based live move; edge and corner resize handles; edge snapping with guide lines; snap zones with preview; Alt disables snapping (including the release-and-re-press of Alt mid-drag); Ctrl-drop on a title bar swaps; Esc cancels and restores; lost capture cancels; maximized drag restores under the pointer; keyboard `Alt+Arrow`, `Ctrl+Alt+Arrow`, `Ctrl+Shift+Arrow`; title bar menu Move / Size modes, "Move to ▸" and "Snap while moving"; announcements (2.10.8 table); `flush` at the end.
- **States:** drag idle, moving, resizing, zone preview, swap target, cancelled.
- **Store unit:** `dragStore` (W1; subscribed only by the dragged frame and the overlay layer)
  ```
  state: {
    kind: 'none' | 'move' | 'resize' | 'keyboardMove' | 'keyboardSize' | 'tileReorder' | 'listReorder' | 'listToWorkspace' | 'popOut'
    pollId: PollId | null
    startRect: Rect | null; currentRect: Rect | null      // currentRect drives the transform
    pointerStart: Point | null; grabOffset: Point | null
    edges: { left; right; top; bottom } | null            // resize
    modifiers: { alt: boolean; ctrl: boolean }
    guides: Guide[]; zone: SnapZone | null; zoneRect: Rect | null
    swapTargetId: PollId | null; slotIndex: number | null; listGapIndex: number | null
    snapEnabled: boolean                                  // "Snap while moving", W1 lifetime
  }
  actions:
    begin(kind, pollId, pointer, rect, extra), update(pointer, modifiers) /* rAF-coalesced; uses task 04 */,
    end(): DragResult /* commit via workspaceStore.setRect / swap / tile insert / pop out */, cancel(),
    keyboardStep(dir, fine), toggleSnap()
  ```
- **Library decision (PM):**
  | Option | Bundle (min+gz, approx.) | Accessibility | Testing | Fit |
  |---|---|---|---|---|
  | Pointer events written directly (`setPointerCapture`) | 0 kB | keyboard paths are ours anyway (2.10.8) | pure functions (tasks 03-04) + a thin hook tested with synthetic pointer events | full control of transform-only rendering and drag-out (R1) |
  | `@dnd-kit/core` (+ sortable for the list) | ~15-20 kB | built-in keyboard sensor and announcements, but its model is drop targets, not free move/resize | good test utilities; needs jsdom layout mocks | good for list reorder; weak for MDI resize and snap |
  | `react-rnd` / `react-draggable` | ~10-15 kB | no keyboard support | needs DOM measurement in tests | move/resize only; no snap zones; re-renders on drag unless tuned |
  Recommendation for the PM: pointer events directly for sub-windows; either pointer events or dnd-kit for the sidebar list. The task's tests do not depend on the choice.
- **Acceptance:**
  - Vitest: `dragStore.update` called 100 times within one animation frame computes snapping once
  - Testing Library (synthetic pointer events): a move of 3 px is a click (no rect change); a move to within 7 px of a neighbor snaps and shows one guide; with Alt held it does not snap; Esc during a move restores the start rect and announces "Move cancelled."; Ctrl-drop on another title bar swaps rects and announces "{a} swapped with {b}."
  - pointer at the left edge shows the preview at `zoneRect('left')` and the drop announces "{name} moved to the left half."
  - `Alt+Right` moves 16 px, `Alt+Shift+Right` 1 px; `Ctrl+Alt+Down` grows the height by 16 px; `Ctrl+Shift+Right` swaps with the right neighbor
  - render-count test: during a 60-step drag, other sub-windows' frames and tables render 0 times

### 16 Tile mode drag reorder
- **Goal:** DES-002 2.10.5: in tile mode, title bar drag shows the slot indicator, release inserts into the list order among tiled windows (calls `pollListStore.reorder`), Ctrl-drop swaps slots, no resize handles, Alt ignored; keyboard `Ctrl+Shift+Arrow` swaps with the adjacent slot; "Move to ▸ Slot 1…n"; announcement "{name} moved to slot {i} of {n}.".
- **States:** tile mode, tile reorder drag.
- **Store:** `dragStore`, `workspaceStore`, `pollListStore`.
- **Acceptance (Testing Library):** with tiles [A, B, C, D], dragging A onto slot 3 gives list order [B, C, A, D] and re-tiles; Ctrl-drop of A on D's title bar gives [D, B, C, A]; dropping on its own slot makes no IPC call.

### 17 Connection window shell rework
- **Goal:** DES-002 2.2: toolbar with File, Connection, + New poll, Window menus, profile label, pill with target, summary chip, state actions; banner and migration notice; sidebar (connection section with auto-collapse rules, poll list slot, hint, resize handle, rail); workspace slot; traffic bar collapsed/expanded; status bar with "{k} in their own windows"; title; live-region rules (W1 announces every poll once; sub-windows silent); `F6` region cycling; narrow-window chip variant.
- **States:** idle, connecting, connected, disconnected; compact rail.
- **Store:** `connectionStore`, `pollListStore`, `trafficStore`, `workspaceStore`, `prefsStore` (task 21).
- **Acceptance (Testing Library + fake):**
  - revision 5 task 08 acceptance (pill stays "Connected" with a poll in timeout; one "4 polls are failing." announcement)
  - the connection section collapses to "TCP 192.168.1.10:502 · timeout 1000 ms" on connect and re-expands on a `refused` disconnect
  - the traffic bar shows "link load 92% - polls are slowed down" with the gauge icon at 92
  - New poll at 16 is disabled with the exact title

### 18 Sidebar poll list: UI, reorder, drag into the workspace
- **Goal:** DES-002 2.2.3, 2.10.6, 2.10.7 (list part): rows with chip, meta and host markers; tooltip; click/Enter = Show; context menu; inline rename; `Ctrl+C`; drag reorder with drop indicator and auto-scroll; `Alt+Up/Down`; drag a row into the workspace with placement preview, snap zones and tile slot; native poll list-drag dock with handoff request and the refusal toast; Esc cancels.
- **States:** every poll state (compact chips), host markers, empty list.
- **Store:** `pollListStore`, `dragStore`, `workspaceStore`.
- **Acceptance (Testing Library):**
  - marker texts "minimized", "own window", "closed" with their icons
  - dragging row 1 below row 3 shows the indicator between 3 and 4 and gives the new order; announcement "{name} moved to position 3 of 4."
  - dropping a closed poll at the workspace's right edge shows it in the right half
  - a refused native list-drag shows "Close the dialog in the "Pump 2" window first."

### 19 Native poll host (W2)
- **Goal:** DES-002 2.6: toolbar (name with rename, pill, Pause/Resume, Write…, connection mini-pill, Connection window, Dock to workspace, `⋯` with Arrange ▸ and Collapse setup panels), banner precedence, PollView with `host="native"`, status bar "Last OK … · Round trip … · Resp … · Timeouts …", title, min 480 x 320, rail forced below 640 px.
- **States:** every poll state; connection states in W2.
- **Store:** `nativePollRuntime` (wraps one `pollViewRuntime`), `connectionStore`.
- **Acceptance:** revision 5 task 10 acceptance (connection banner wins, no Disconnect, unapplied edits reported); the status bar no longer contains "Tx"; at 600 px width the setup shows as a rail.

### 20 Host lifecycle: show, pop out, dock, close, handoff
- **Goal:** DES-002 2.5 and 2.11: Show (H12-H14) from sidebar, Window menu and `RevealPoll`; pop out (button, menu, `Ctrl+Shift+O`) with spinner, handoff and failure toast; dock (button, `Ctrl+Shift+D`) with handoff, W1 to front; S6 in both hosts with conditional sentences and "Don't ask again"; W1 close with "This also closes {k} poll windows." and unapplied names; `HandoffRequested` answering in W2 (null when a modal is open).
- **States:** host states H1-H17; S6; W1 close confirm.
- **Store unit:** `pollHostStore` (one per webview)
  ```
  state: { pending: Record<PollId, null | 'show' | 'popOut' | 'dock' | 'close'> }
  actions:
    show(id, placement?), popOut(id, anchor) /* reads pollViewUiStore.toHandoff() */,
    dock(id) /* W2 */, requestClose(id) /* S6 or keep when askOnPollClose is false */,
    confirmClose(id, keep), answerHandoffRequest(id)
  ```
- **Acceptance:**
  - Vitest: `popOut` keeps the SW mounted until the IPC call resolves; on rejection the SW stays and the toast "Could not open the poll window: {message}" shows
  - Testing Library + fake: pop out a polling poll with rows 3-5 selected, top address 2, and an invalid Quantity draft; the W2 runtime shows the same selection, top row, draft and message, live values without "Waiting for first response…"; dock back gives the same in the SW
  - S6 texts exactly in both hosts; Keep calls `closePollView(id, true)`; Delete `(id, false)`; Cancel nothing
  - W1 close with 2 popped-out windows and unapplied edits in "Pump 2": "… This also closes 2 poll windows. Unapplied edits in: Pump 2."
  - Playwright (fake): closing W1 closes its W2 windows

### 21 Arrange popped-out windows, monitors and compact mode
- **Goal:** M2 in W1 and W2 (layouts, "Arrange on:" radio with "Each monitor (in place)" and "Display k (primary)"), `Ctrl+Shift+T` in W2, toasts (none, overflow, missing display), target remembered for the W1 lifetime; compact mode toggle (`Ctrl+Shift+\`, menus) mirrored from `PrefsChanged`, W1 rail with state icons, per-host local override.
- **States:** arrange target; compact on/off.
- **Store units:**
  ```
  arrangeStore (W1 and W2)
  state: { monitors: MonitorInfo[]; target: ArrangeTarget /* default eachMonitor */; pending: boolean }
  actions: loadMonitors(), setTarget(t), arrange(layout) /* arrangePollWindows; toasts from ArrangeResult/errors */

  prefsStore (W1 and every view; replaces windowPrefsStore)
  state: { askOnPollClose: boolean; compact: boolean }
  actions: applyPrefs(evt), setAskOnPollClose(b), setCompact(b)
  ```
- **Acceptance:**
  - Vitest: `arrange('tile')` with `ArrangeResult { arranged: 12, overflow: 1 }` shows "1 window did not fit and was cascaded."; a `field: "monitor"` rejection shows "That display is no longer connected." and resets the target to each monitor
  - Testing Library: compact on closes every SW dock, turns the sidebar into the rail with one icon per poll, and a W2 shows the rail; `Ctrl+\` in one SW opens only that SW's dock
  - the radio lists "Display 1 (primary)" first

### 22 Write from poll views
- Revision 5 task 12, in both hosts: dialog title "Write · {poll name}", modal of the host (centered on W1 for a SW), `pollId` in the request, alias line (DES-003 3.5 revision 6).
- **Acceptance:** the fake receives `pollId`; W1 traffic shows "Write: {poll name}"; FC06 at an aliased address shows "Alias: PT-201"; focus returns to the SW's grid after closing.

### 23 Profiles v2: export, apply, migration, modified rules, layout and aliases
- **Goal:** revision 5 task 13 plus: export/apply of `workspace` settings, `view` placements, z-order, list order and `aliases`; restore hosts on load (SW mounted, W2 opened) without S6 for closed views; `isDirty` rules of DES-002 6.1.
- **States:** profile loading, empty, error, migrated.
- **Store unit:** `profileStore` (W1), as revision 5, with the dirty-relevant subset extended by `aliases`, `showAlias`, `copyAlias`, and explicitly excluding layout, host and order.
- **Acceptance:**
  - Vitest: `isDirty` stays false after reorder, move, resize, tile, compact, pop out, dock, minimize, traffic expand; turns true after an alias commit and after "Include alias in copy"
  - round trip: a profile with 4 SW (one minimized, one maximized), 2 W2, tile mode on, compact on, list order changed and aliases on 2 polls, exported then applied, gives a deep-equal export (z values re-numbered only when duplicated)
  - a schema-1 profile opens as one SW "Poll 1" with the notice, not Modified

### 24 Shortcut maps per host
- **Goal:** the three columns of DES-002 3.1 (W1 outside sub-windows, W1 scope SW, W2) on the FE-001 registry, with focus-scoped resolution for SW keys and text-input exclusion for move/resize/swap keys; suppressed browser defaults listed in 3.1; save relay from W2.
- **Acceptance (Testing Library):** each row triggers its action in the right scope and nothing in the others; `Ctrl+L` in W2 while connected does nothing; `Alt+Right` inside an alias editor moves the caret, not the window; `F2` in the grid edits the alias and on the title bar renames.

### 25 Traffic bar and filter UI
- **Goal:** collapsed bar (counters, link load and the ≥ 90% variant, Expand), expanded panel (revision 5 task 15: filter "All polls", "Writes", polls in list order; Poll column; filtered counters; empty text), `Ctrl+J`, "Show traffic for this poll" from a SW (local) and from a W2 (`showTraffic`) expanding the panel.
- **Acceptance:** "Show traffic for this poll" in a SW expands the panel with that filter; deleting the filtered poll switches to "All polls".

### 26 Pop out by drag (risk R1)
- **Goal:** DES-002 2.10.7 drag out: pop-out mode beyond 48 px or outside the client area, ghost card, label "Release to open in its own window", release calls `popOutPoll` with `{ kind: "cursor", grabOffset }`, Esc cancels. Start with a 1-day spike on WebView2 to confirm pointer capture outside the window; record the result in the task notes. If it fails, ship with the feature flag off and tell the PM.
- **States:** pop-out mode.
- **Store:** `dragStore` (`kind: 'popOut'`).
- **Acceptance:** Vitest with synthetic events: leaving by 49 px enters pop-out mode and returning to 40 px leaves it; release calls `popOutPoll` once with the grab offset. Playwright (integration, Windows): the W2 appears with its title bar under the cursor.

### 27 Dock by drag (phase 2, Windows only, risks R3-R5)
- **Goal:** consume `DockPreview` in W1 (tile-area outline, label "Release to dock in the workspace", placement or slot preview), report `setWorkspaceBounds` on resize end, answer `HandoffRequested`. Depends on the BE phase 2 `WindowMoveObserver`.
- **Acceptance:** with the fake emitting `DockPreview` and then a dock, the preview shows and hides and the SW appears at the previewed rect; no preview for a W2 of another connection.

### 28 Performance and accessibility verification
- **Goal:** prove REQ-002 "8 polls at 100 ms" in the new layout, plus drag performance and focus/announcement rules.
- **Acceptance:**
  - Playwright browser smoke (fake), 60 s: 8 polls at 100 ms, all 8 as sub-windows tiled in one W1: 0 long tasks over 50 ms; Pause of one poll reaches "Paused" within 100 ms
  - same with 4 SW + 4 W2 windows
  - drag smoke: 30 s of continuous scripted drag and resize of one SW while the 8 polls run: 0 long tasks over 50 ms; other tables' render counts unchanged during the drag
  - WebView2 integration runs recorded separately with the same criteria
  - memory flat within 10% over 10 minutes after the traffic buffer is full
  - focus order and `F6` regions as DES-002 9; every 2.10.8 announcement fires once

---

## Implementation notes (part A: tasks 01-12, 2026-10-16)

What exists, where it differs from the task text, and the seams for part B (tasks 13-28) and FE-003. All types are the generated bindings of the BE-002 Final contract; no TEMP type is left.

### Layout of the code
- `shared/ipc/`: `modbus-master.ts` (facade v3, one function per DES-002 8.2 command, Tauri implementation), `modbus-master.fake.ts` (+ `fake-scheduler.ts`, `fake-validation.ts`), `modbus-master.types.ts` (barrel over `shared/bindings`, plus derived event aliases), `errors.ts` (`IpcError`, shared by both facade versions), `window.ts` (`listMonitors` and the fake monitor list), `runtime.ts` (`modbus` = v3, `legacy` = v1, `window`). `shared/ipc/legacy/` is the single-poll facade, its fake and a frozen copy of the revision-1 DTOs (`v1-bindings.ts`): the old window (`tools/modbus-master/components`, `runtime/controller.ts`, `store/session*`, `store/config*`, `store/legacy-*`) still runs on it and its 937 tests are untouched. Delete `shared/ipc/legacy/` and the `legacy-*` stores together with the old shell in task 17. Against the BE-002 backend the old window cannot work (its commands are gone).
- `shared/lib/layout-math.ts` (task 03, shared because the fake arranges native windows with it), `shared/lib/placement.ts` (`restorePlacement`, `cascadePlacement`), `shared/ui/menu.tsx` (`MenuButton`, `ContextMenu`), `shared/ui/status-strip.tsx`, new `StatusPill` variants `offline` and `waiting`, new icons, tokens `--color-warning-tint`, `--color-workspace`, `--shadow-subwindow`.
- `tools/modbus-master/lib/`: `poll-summary`, `poll-names`, `titles`, `status-line`, `alias`, `address-ranges`, `handoff` (zod `PollViewHandoffV1`), `copy`, `scaled` (the FE-003 seam), `drag-math` (task 04).
- Stores (`tools/modbus-master/store/`): `connection` (+ `.logic`), `poll-list` (+ `.logic`), `poll` (+ `poll.logic`, `poll-draft.logic`), `poll-view-ui`, `poll-data` (+ `.logic`), `alias`, `traffic` (+ `traffic.logic`, now with filter and per-poll counters). Each has a `*.test.ts`.
- `runtime/poll-view-runtime.ts`: `createPollViewRuntime(deps)` builds the per-view stores, attaches the view channel, applies snapshot and handoff, and wires the stores (see its header comment). `runtime/clipboard.ts`.
- `components/poll-view/`: `PollView` (props: `runtime`, `host`, optional `scaleSection`, `focusName`, `popoverMaxHeight`), `StatusLine`, `DataCard`, `DataGrid`, `ScaledCellView`, `PollSetup`, `context.tsx` (hooks, `useElementWidth`), `poll-view.logic.ts`, `test-utils.tsx` (harness with a controllable ResizeObserver).

### Seams for part B
- **Workspace frame, sub-windows (13-16):** the frame renders `<PollView runtime host="workspace">`, owns the title bar and the `⚙` button (`runtime.stores.ui.toggleSetup()`, dot from `runtime.stores.poll` `hasUnappliedEdits`), and disposes the runtime when the sub-window unmounts (`PollView` calls `runtime.init()` but never `dispose()`, so React StrictMode cannot detach it). `createPollViewRuntime({ onDetached(cause) })` tells the host to unmount: causes `poppedOut | docked | replaced | closed | removed | attachFailed`. `pollListStore.reorder`, `insertAmongSubset`, `neighborInDirection`, `adjacentSlot`, `snapRect`, `snapZoneAt`, `zoneRect`, `popOutModeFor` and the rest of `lib/drag-math.ts` are the pure parts of 15, 16, 18 and 26. `workspaceStore`, `dragStore`, `prefsStore`, `arrangeStore`, `pollHostStore`, `profileStore` do not exist yet.
- **Host actions:** `PollHostActions` (`popOut`, `dock`, `close`, `deletePoll`, `showTraffic`, `write(address | null)`, `rename`, `duplicate`) is passed in `createPollViewRuntime`; the `⋯` menu and the grid (double-click or Enter on a row) call them and show only what the host provides. Pop out and dock read `runtime.stores.ui.getState().toHandoff()`; a view that starts with a handoff applies it from the attach snapshot.
- **Session wiring in W1:** a `connectionRuntime` creates `connectionStore` (role `window`), calls `ipc.openSession`, applies `snapshot.connection` and forwards `ConnectionStateChanged` (the same event also reaches every view; the second copy is ignored by `applyConnectionStateChanged`), applies `PollListChanged`, `PollStateChanged` and `Counters` to `pollListStore`, and `TrafficFrames` to `trafficStore.appendFrames` (batch with `createBatcher`). `trafficStore.setPollOrder(order, names)` must be called on every list change. A native window passes its own `createConnectionStore({ role: "poll" })` to the view runtime (it learns the connection from the attach snapshot) and `getOtherNames` omitted.
- **Compact mode and prefs:** `PrefsChanged` reaches the view through `ui.applyCompact`; the host gets `onPrefsChanged`. Setup presentation per host and width is `setupPresentationFor` (a native window starts with its panel open; compact mode and widths under 640 show the rail).
- **FE-003:** pass `createScaled(config) => (raw, address) => ScaledCell | null` to the runtime (`lib/scaled.ts` describes the cell: text, unit, marker, tooltip, accessible label, override marker); copy, the Scaled column, the Show control and the "Copy scaled" menu entries already use it. `hasAnyScale(config)` enables Scaled and Both. The SCALE and OVERRIDES sections go into `PollView`'s `scaleSection` prop; their unapplied state goes to `ui.setScaleDraft({ dirty, fields })` (travels in the handoff and counts as an unapplied edit). Add `ScaledCellView`-style warning classes only in `ScaledCellView.tsx` (the only file besides the status primitives allowed to use `bg-warning-tint`, see `tokens.test.ts`).

### Decisions and deviations (none against the design text; points the tasks left open)
1. **Legacy window kept.** The old single-poll shell is not reworked in part A (task 17 owns it). Its facade, fake and types moved to `shared/ipc/legacy/` with a frozen DTO copy so it compiles and its tests pass whatever the bindings become. `runtime.ts` returns both facades; `VITE_FAKE_IPC` installs `window.__ESEFACT_FAKE_IPC__` (v3 fake) and `window.__ESEFACT_FAKE_LEGACY_IPC__` (v1 fake, used by the old page).
2. **Selection by address.** Task 11 lists `tableSelectionStore`; the handoff needs address ranges (DES-002 2.5.4), so the selection lives in `pollViewUiStore` (`selection`, `anchorAddress`, `focusAddress`, `click`, `moveFocus`, `selectAll`). The FE-001 index-based store is unchanged and unused by the new view.
3. **Effective scan rate.** Rust reports `PollCounters.effectiveScanMs`; the store shows it only when it is above 1.5 x the scan rate (`effectiveScanShown`). There is no `applyPollUpdateMeta`.
4. **Pending flags** of `pollStore` clear when the command settles (not by a matching event).
5. **Setup in a native window:** `Ctrl+\` and the shortcuts are task 24; the panel has a small collapse button (`chevron-left`) so it can be closed with the mouse before the toolbar exists.
6. **Status line widths:** `ID`/`F` hide below 430 px and the reason text below 560 px of the status line (CSS container queries, not testable in jsdom); `Tx`, `Err` and `SR` never hide.
7. `biome.json`: `DataGrid.tsx`, `ScaledCellView.tsx`, `PollView.tsx` and `shared/ui/menu.tsx` join the files exempt from `useSemanticElements`, `useFocusableInteractive` and (new) `useAriaPropsSupportedByRole`, like the FE-001 grid files.
8. The fake follows the BE-002 Final contract: nested `PollSummary`, flat events, `mm_set_poll_view` as a patch, `active` set by Rust from "Start polling when connected", no `PollStateChanged` for a poll added while connected, `applyProfile` returns the snapshot, only `pollNotFound` has its own code. Modes: `manual` (default, nothing happens by itself), `virtual` (full backend, time moves with `advance(ms)`), `realtime` (`simulate: true`, dev server).

### Questions for the designer
- **Q-FE2-01** Texts the design does not give: paused poll that never ran, "Poll paused. Press Resume (Ctrl+P) to read {qty} {items} from slave {id}."; offline with the connection `connected` (transient), "Waiting for the connection…"; "Connecting to the device…" when the target is unknown; clipboard read failure "Could not read the clipboard.".
- **Q-FE2-02** DES-002 2.3.2 says `SR 100 ms (effective {n} ms)` fires above 1.5 x the scan rate, but the FE task example uses 140 ms at 100 ms. The code follows the 1.5 rule.
- **Q-FE2-03** The popover is anchored at the top right of the poll view, not under the `⚙` button (the button belongs to the frame, part B). Confirm or let part B pass an anchor.

---

## Implementation notes (part B1: tasks 13-17, 2026-10-16)

The app now runs on the new model: the page mounts the connection window W1 on the v3 facade. The legacy single-poll window, `shared/ipc/legacy/` (facade, fake, frozen v1 DTO copy) and the legacy stores are deleted together with their tests.

### Layout of the code
- `runtime/connection-runtime.ts` (`createConnectionRuntime(ipc, windowIpc, options)`): every store of W1, the session channel (events before the snapshot are held and replayed, REV-002 M3), the wiring (poll list -> workspace and traffic filter names, workspace -> view disposal and sidebar selection, connection transitions -> CONNECTION section and live region, poll failures -> live region with a 1 s window and "{n} polls are failing.", command errors -> toasts and form field messages), the `views` registry (one `PollViewRuntime` per sub-window, created when its frame first asks, disposed when the sub-window leaves the workspace, so React StrictMode cannot detach it) and the actions (`connect`, `toggleConnection`, `newPoll`, `togglePauseAll`, `showPoll`, `copyFrame`, ...). `runtime/connection-form.ts` is the gateway the CONNECTION form registers in (default: the draft store). `runtime/window-runtime.ts` is the per-window singleton.
- Stores (`store/`), each with a Vitest file: `workspace` (+ `.logic`), `drag` (+ `.logic`), `prefs`, `poll-host` (+ `.logic`: S6 and S7 only), `announcer` (+ `announcements.logic`), `connection-section` (+ logic), `connection-draft`, `profile-info`, `layout` (trimmed: modal locks, traffic column widths, sidebar peek), `serial-ports`, `write` and `profiles` (retargeted to the v3 facade and types; their UIs are tasks 22 and 23). `poll-list.store` gained `setOrder`.
- Components: `components/ConnectionWindow.tsx`; `shell/` (Toolbar with the File, Connection, New poll and Window menus, ConnectionBanner, StatusBar, LiveRegions, ResizeSeparator, `use-shortcuts`, `use-regions` for F6); `sidebar/` (Sidebar and rail, ConnectionSection with its RHF hook, PollList); `workspace/` (Workspace, SubWindowFrame, TitleBar with its menu, ResizeHandles, MinimizedBar, DragOverlay, `pointer-gesture.ts`, `frame-keys.ts`); `traffic/` (TrafficBar, TrafficPanel ported to the new traffic store); `dialogs/PollDialogs.tsx` (S6, S7); `form/` (field, ControlledSelect); `PollChip.tsx`.
- Pure helpers: `lib/window-menu.ts`, `lib/poll-row.ts`, `components/workspace/title-bar-menu.logic.ts`.

### Task status
- **13** done: workspace store and frame (title bar buttons, minimize, maximize, restore, close -> S6, z-order, `aria-current`, minimized bar, empty texts, `Ctrl+F6`, new-window slots, clamping, layout reporting at action end, status line through the shared PollView, setup dock or popover, compact mode with the sidebar rail).
- **14** done: Window menu M1, Tile (WT-1 to WT-3 tested), Cascade, tile mode with re-tiling on every change, overflow toast, Arrange minimized, Minimize all, Restore all, corner indicator.
- **15** done: pointer events written directly (no library). Move, resize (8 handles), edge snap with guides, snap zones with preview, Ctrl swap, Esc, lost capture, maximized drag, Alt (R7: Alt keydown and keyup are prevented during a drag), keyboard `Alt+Arrow`, `Ctrl+Alt+Arrow`, `Ctrl+Shift+Arrow`, title bar menu Move, Size, Move to, "Snap while moving", announcements. Not done on purpose: pop out by drag (task 26).
- **16** done: tile mode reorder by drag (slot indicator, insert into the list order among the tiled windows), Ctrl swap of slots, `Ctrl+Shift+Arrow` to the adjacent slot, "Slot n" menu entries.
- **17** done (basic parts below): toolbar and menus, summary chip, pill with target, banner, sidebar (CONNECTION section with the collapse rules, basic POLLS list with New poll, click to show, row actions Show, Pause or Resume, Delete and S7), workspace, minimized bar, traffic bar and panel, status bar, version label, title, live regions, F6.

### Decisions and deviations (against the task text, not the design)
1. **Pop out and dock** are not in the title bar: the button and menu entry appear when the runtime gives `hostActions.popOut` (task 20). The `Popped-out windows` menu item is present but disabled ("No poll is open in its own window." or "Not available yet.", task 21). File > Open profile, Save, Save as are disabled with the title "Profiles are not available yet." (task 23).
2. **`workspaceStore` API** differs in names from the task sketch: `applyLayout`, `syncFromList` (mount and unmount follow `host` and `open` of the poll list), `reveal`, `show`, `unmount`, `tile`, `cascade`, `setTileMode`; `size` is `{ width, height }`. Low-level actions (`activate`, `setRect`, `swap`) never report; actions that are a whole user action (`minimize`, `maximize`, `restore`, `tile`, `cascade`, `show`, ...) report once. `flush` skips a layout that equals the one Rust has, so a click on a window that is already in front sends nothing.
3. **`Ctrl+F6`** cycles in list order, not z-order (a full, predictable cycle).
4. **Title bar menu "Move to"** is a heading followed by its entries (the shared menu has no submenu).
5. `prefsStore` (compact, askOnPollClose) and the S6 and S7 part of `pollHostStore` were built here because the close buttons and the Window menu need them. Task 21 still owns `arrangeStore`; task 20 extends `pollHostStore` (show, pop out, dock, handoff).
6. The traffic panel already has the Filter select (All polls, Writes, polls in list order) and the Poll column, because "Show traffic for this poll" needs a way back. Task 25 keeps the rest of its list.
7. **Shortcuts**: only the ones the menus show and the workspace needs (`Ctrl+L`, `Ctrl+N`, `Ctrl+Shift+N`, `Ctrl+P`, `Ctrl+Shift+P`, `Ctrl+J`, `Ctrl+Shift+K`, `Ctrl+Shift+T`, `Ctrl+Shift+C`, `Ctrl+F6`, `Ctrl+F4`, `Ctrl+\`, `Ctrl+Shift+\`, `Ctrl+Shift+A`, `F6`, the window keys). Task 24 does the per-host maps. The DOM order of the frames is by poll id, not front first (task 28).
8. **Menu item names** include the shortcut text with no space ("TileCtrl+Shift+T" in the accessibility tree). Tests match with `^`. A space or `aria-keyshortcuts` is a shared-menu change for task 28.
9. Compact mode: `Ctrl+\` or the rail button "Show sidebar" opens the full sidebar as a temporary peek that ends when compact mode is toggled.

### Bugs found and fixed while building
- `StatusPill` ignored the `title` the status line passed (the tooltip with the banner text never showed). It now has `title` and `fullLabel` (a short chip text is `aria-hidden`, the full label is the accessible name; `aria-label` on a span is not valid).
- A press, double click or right click inside the title bar menu bubbled through the React portal to the title bar: it started a drag gesture whose window key listener swallowed Esc. Guarded in `pointer-gesture.ts` and `TitleBar`.
- A new poll was mounted with a 0 x 0 rectangle when the workspace was not measured yet; it uses the default size now.
- The fake emitted no `PollListChanged` after `setWorkspaceLayout`; Rust does when a rectangle changed.

### REV-005 minors
Done: m-1 (W1 does not apply the connection events of view channels, `sharedConnection`), m-2 (a view without a handoff reports its real unapplied flag), m-3 (the poll view does not re-render per update: the freshness chip is the only reader of `lastOkAt`; `DataCard` and `DataGrid` are memoized; menu `insideRefs` and the `ContextMenu` close callback are stable; `DataGrid.perf.test.tsx` and `WorkspacePerf.test.tsx`), m-4 (Biome override only for the files that need the two grid rules; the rest use per-line ignores with a reason; the override marker is `role="img"`), m-5 (the fake emits `PollConfigChanged` only for a real change, an identical Apply is a no-op, `validate_poll` rules, raw `effectiveScanMs`, monitor id = name; REV-004: the pop out order and failure, `invalidState` for a second dock, anchor validation), m-6, n-1, n-2, n-3, n-4, n-7. Not done: n-6 (`sameSummary` and the counters inside the poll summary); n-5 is moot (the frozen v1 copy is deleted).

### Not verifiable in jsdom
Real pointer capture and drags with a mouse, pointer events outside the window, layout in WebView2 (container queries, `ResizeObserver` sizes, the 24 px zone band), Alt and the Windows system menu (R7), `Ctrl+Alt+Arrow` and graphics drivers (R6), focus rings, fonts, the 8 polls at 100 ms performance criterion, and everything that needs the real backend.

### Seams for part B2
- Task 18: `PollList` and its `Row` (drag handle, inline rename, full menu, `dragStore` kinds `listReorder` and `listToWorkspace`; `workspace.reveal` takes a drop rectangle, `dropRect()` in `workspace.logic` is the preview rectangle).
- Task 20: `pollHostStore` (add show, pop out, dock, handoff answer), `hostActions.popOut` and `dock` in `views.get`; `onDetached('poppedOut')` already unmounts and a failed pop out remounts (tested against the fake); `closePollView` and S6 exist; the W1 close confirm is open (`onCloseRequested` is not registered yet).
- Task 21: `arrangeStore`, the Window menu item `Popped-out windows`; `prefsStore` and the rail exist.
- Task 22: `write.store` takes `getPollId`; the dialog and `hostActions.write` are open.
- Task 23: `profileInfoStore` holds name and modified; the File menu entries and the `SaveRequested` case in `route` are the seams; the CONNECTION form takes a connection through `runtime.form.current.adopt`.
- Task 24: `use-shortcuts.ts`, `frame-keys.ts`, `use-regions.ts`.
- Task 26: the `drag.store` kind union is to be extended; `popOutModeFor` is in `lib/drag-math.ts`; `startPointerGesture` is the pointer part.
- Task 28: the render-count tests exist (`WorkspacePerf.test.tsx`); DOM order of the frames.

### Questions for the designer
- **Q-FE2-04** The snap zone band is 24 px from the tile area border, measured from the pointer. A sub-window at its default place (8, 8) has its title bar centered at y = 23, so pressing it there and moving sideways shows the full-area zone at once, and releasing in the band snaps. Implemented as written. Option: zones only after the pointer has left the band once during the drag, or a band of 8 px like Windows.
- **Q-FE2-05** "Move to" has no submenu in the shared menu (flat list under a heading). Fine?
- **Q-FE2-06** File > Close window closes at once until task 20 adds the W1 close confirm. Fine for now?

---

## Implementation notes (part B2a: tasks 18-21 and the Q-FE2-04 fix, 2026-10-16)

The poll list is complete, a poll can be popped out and docked by button, menu, shortcut and list drag, the native poll window W2 exists, W1 asks before it closes, and the popped-out windows can be arranged. Not in this round: tasks 22-25 and 28, pop out and dock by dragging a window (phase 2), FE-003.

### Layout of the code (new or changed)
- **Task 18, sidebar list:** `components/sidebar/PollList.tsx` (rows, `DropIndicator`, row keys), `list-gesture.ts` (pointer press, 4 px threshold, release, Esc, lost capture, auto-scroll, click suppression after a drag), `ListDragLayer.tsx` (the ghost), `components/InlineRename.tsx` (shared by the row and the title bar), `lib/poll-row-menu.ts` (the row menu, pure), `lib/poll-row.ts` (`pollRowCopyText`). Drag state: `drag.store` gained `listReorder` and `listToWorkspace` (`beginList`, `updateList`, `end`), `drag.logic` gained `computeListPlacement`, `lib/drag-math` gained `placeInSubset` and `autoScrollDelta`. `DragOverlay` draws the placement preview (`data-testid="list-preview"`). The orchestration of a drop (`placePollFromList`, `movePoll`, `copyPollRow`, `popOutPoll`, `dockPoll`) is in `runtime/connection-runtime.ts`.
- **Task 19, native window:** route `/tools/modbus-master/poll?pollId=<id>` (`tools/registry.ts` has `extraRoutes`, `app/routes.tsx` maps them), `NativePollPage.tsx` (`parsePollId`), `runtime/native-poll-runtime.ts` (stores of one W2: connection with `role: "poll"`, host, prefs, arrange, announcer, layout, toasts, plus the one `PollViewRuntime` with `host: "native"`), `runtime/native-window-runtime.ts` (one runtime per window), `components/native/` (`NativePollWindow`, `NativeToolbar`, `NativeBanner`, `NativeStatusBar`, `context`, `use-native-shortcuts`), `store/native-poll.logic.ts` (banner precedence, status bar text, Pause label, title state). `createPollViewRuntime` got `onSnapshot` (W2 reads compact mode and "Don't ask again" from the attach snapshot).
- **Task 20, host lifecycle:** `store/poll-host.store.ts` (+ `.logic`) now has `show`, `popOut`, `dock` and `answerHandoffRequest` next to S6 and S7; `store/window-close.store.ts` is the W1 close question (separate store: it is a window concern, not a poll concern). Dialogs are views of a store (`components/dialogs/PollDialogViews.tsx`) so W1 and W2 share them. `pollListStore.show` moved to `pollHostStore.show` (its tests moved too).
- **Task 21, arrange and compact mode:** `store/arrange.store.ts`, `lib/arrange-menu.ts` (the M2 entries), `lib/window-menu.ts` (the `Popped-out windows` submenu), `overflowToast` moved to `store/workspace.logic.ts`. `shared/ui/menu.tsx` has real submenus (`kind: "submenu"`).

### Task status
- **18** done: rows as in B1 plus the grip (shown on hover and focus), inline rename (F2, the menu), the full menu (Show, Show in workspace, Pop out or Dock, Pause or Resume, Rename, Duplicate, Move up, Move down, Show traffic, Delete…), Shift+F10 and the menu key, Ctrl+C, `Alt+Up` and `Alt+Down` (announced, focus stays on the row), drag reorder (ghost at 80%, row at 40%, 2 px indicator with an 8 px circle, auto-scroll 8 px per frame within 24 px of the edge, Esc, no click after a drag), drag into the workspace (preview rectangle, snap zone, tile slot; a closed poll is shown there, a sub-window is moved and restored, a native poll is docked with a handoff request; refusal toast "Close the dialog in the "{name}" window first."). The list order is sent with `mm_reorder_polls` (optimistic, rolled back on error) and never marks the profile Modified.
- **19** done: toolbar (name with pencil and F2, state pill, Pause or Resume, Write… (disabled until task 22), connection mini-pill, Connection window, Dock to workspace, `⋯` with Arrange poll windows ▸ and Collapse setup panels), banner precedence (connection banner wins, never both, no Disconnect, Cancel or Dismiss), status bar "Last OK … · Round trip … · Resp … · Timeouts …", window title with "Offline" while the link is down, the OS close request opens S6, the handoff request is answered, own live region, shortcuts of the W2 column that tasks 19-21 need (Ctrl+L connect only, Ctrl+P, Ctrl+Shift+D, Ctrl+Shift+M, Ctrl+Shift+T, Ctrl+Shift+A, Ctrl+\, Ctrl+Shift+\).
- **20** done: show, pop out (button with spinner, title bar menu, status line menu, row menu, Ctrl+Shift+O; the sub-window stays until the command resolves; the editor in focus is blurred first; the layout is reported first; the handoff is read after the blur), dock (W2 button, status line menu, Ctrl+Shift+D, the row menu, the list drag), the failure toasts, the "docked" announcement, S6 and S7 in both hosts with their sentences and "Don't ask again", W1 close with "Save changes?" (see decisions), a dialog closes by itself when its poll is deleted elsewhere.
- **21** done: Window > Popped-out windows ▸ (Tile, Side by side, Stacked, Cascade, "Arrange on:" with Each monitor (in place) and one radio per display, "Display 1 (primary)" first), the same in the W2 `⋯` menu, the toasts (none open, overflow, display gone), compact mode from both hosts.
- **Q-FE2-04** done: `zonesArmed` in the drag state. A press inside the 24 px band does not arm the zones; the first pointer position outside the band arms them for the rest of that drag. Edge snapping works while they are not armed. A list drag starts outside the workspace, so it needs no arming.

### Decisions and deviations (none against the design text; points the tasks left open)
1. **Real submenus.** The shared menu has `kind: "submenu"` (Right or Enter opens, Left or Esc goes back, a press in the second list is not an outside click). It is used for Popped-out windows ▸ and Arrange poll windows ▸. "Move to" in the title bar menu is still the flat list (Q-FE2-05 stands).
2. **Menu names.** The entries are named as in DES-002 2.8 (Tile, Side by side, Stacked, Cascade). The mockup `Workspace.dc.html` writes "Tile (2 x 2)", "Side by side (1 x N)", "Stacked (N x 1)" (question below).
3. **Save changes? without profiles.** The profile store is task 23. The dialog and its three buttons exist and follow DES-002 2.11; `createConnectionRuntime` takes `saveProfile`, and while it is missing Save is disabled with the title "Profiles are not available yet." and Cancel has the focus. File > Close window, Alt+F4 and the OS close all ask the same question (`windowClose.request()`); `profileInfo.modified` is still always false until task 23, so today only unapplied poll edits ask.
4. **Pop out anchor.** The anchor is the sub-window rectangle plus the workspace origin in client coordinates (`getWorkspaceOrigin`, default the `[data-workspace]` element). A maximized one uses its normal rectangle, a minimized one the rectangle it had; a view that was never attached sends no handoff.
5. **Closed polls** have no Pop out entry (there is no view to pop out); "Show in workspace" is offered only for a closed poll whose last host was its own window.
6. **Arrange target per window.** "Arrange on:" is remembered for the life of the window that chose it. W1 and every W2 are separate JS contexts, so a W2 starts with Each monitor (in place).
7. **W2 toolbar** wraps to a second line below about 720 px instead of hiding controls (min height 60 px).
8. **Announcements** that DES-002 2.10.8 does not list: a list drop as a plain rectangle says "{name} shown in the workspace."; a drop in a zone or slot uses the zone and slot texts. The "docked" announcement comes from the list change native to workspace (so every route, W2 button, list menu and list drag, says it once); a pop out that failed passes through the same change and is suppressed while its command is pending.
9. **`useModalLock` for dialogs** is now `useModalLockOn(layout)` in `PollDialogViews` (one lock per dialog on the window's own layout store).
10. **Fixed on the way:** the old S6 and S7 kept their modal lock (shortcuts off) when the poll was deleted in another window while the question was open. They close themselves now. A click on a button, a field or a menu entry inside a row no longer also "shows" the poll (the menu is a portal; its events bubbled to the row).
11. **biome.json** is unchanged: no override was needed. The Python-based edits of this round briefly wrote CRLF into a few files; `biome check --write` brought them back to LF.

### Not verifiable in jsdom (needs a real window or WebView2)
Real pointer capture and drags with a mouse (the list drag and the 24 px band), auto-scroll speed, pointer events leaving the window, how the second list of a submenu is placed at the screen edge, the `touch-action` of the rows, focus rings and fonts, whether a click after a drag is really swallowed (the capture-phase `click` listener is tested with synthetic events only), the behavior of `onCloseRequested` in Tauri v2 (the handler is async and the window waits for it), the real W2 window (route and query parsing in a real webview, its minimum size, taskbar entry), `Channel` ordering between a rollback `PollListChanged` and the rejected `mm_pop_out_poll` (a very late rollback event would be announced as a dock), and `app_list_monitors` on real monitors.

### Capabilities
No new permission is needed: the windows use `setTitle`, `onCloseRequested` (event listen) and `destroy`, which `capabilities/default.json` has for `main` and `modbus-master-*` (the W2 labels match). Arrange, monitors, pop out, dock, show and focus are commands.

### Seams for B2b (tasks 22-25 and 28)
- **22 Write:** `hostActions.write` is missing in both hosts (the W2 toolbar button is disabled with a title and keeps its place). The Write dialog must hold a modal lock on its window's `layout` store (`PollDialogViews` shows how) so pop out, dock and the handoff answer know a modal is open.
- **23 Profiles:** `createConnectionRuntime({ saveProfile })` is the Save of the close question; `profileInfoStore.setModified` and `setName`; the `SaveRequested` case of `route`; `windowClose` summary reads the profile name and `modified`. A W2 `Ctrl+S` goes through `mm_request_save`.
- **24 Shortcuts:** W1 `use-shortcuts.ts` (now with Ctrl+Shift+O), W2 `components/native/use-native-shortcuts.ts` (missing: Ctrl+Shift+N, Ctrl+E, F2 in the grid, Ctrl+S, Ctrl+N, F6). Both use `createShortcutHandler`.
- **25 Traffic:** unchanged; W2 "Show traffic for this poll" calls `showTraffic(pollId)`.
- **26 Pop out by drag:** `drag.store` kinds are still a union to extend with `popOut`; `popOutPoll` takes any `PopOutAnchor`, the cursor variant is not used yet.
- **28:** the render-count tests of B1 still hold (`WorkspacePerf`); the list rows select only their own slice. Open: the DOM order of the frames.

### Questions for the designer
- **Q-FE2-07** The mockup menu reads "Tile (2 x 2)", "Side by side (1 x N)", "Stacked (N x 1)"; DES-002 2.8.5 and CHK-002 H1 say Tile, Side by side, Stacked, Cascade. Implemented as the DES. Which wins?
- **Q-FE2-08** The "Arrange on:" target is per window (W1 and each W2 keep their own). Should Rust hold one target per connection?
- **Q-FE2-09** W2 toolbar: Write… is disabled until task 22, and the toolbar wraps below about 720 px. OK?
- **Q-FE2-10** Close question: Save is disabled until profiles exist (task 23) and Cancel is the default button meanwhile. OK?
- **Q-FE2-11** A closed (kept) poll has no Pop out entry, only Show (and "Show in workspace" when its last host was its own window). OK?
- **Q-FE2-12** DES-002 2.10.8 has no announcement for a list drop into the workspace. Added: "{name} shown in the workspace." (plain rectangle), the zone text, the slot text.
- **Q-FE2-13** A list drag over the sidebar but above the first row or below the last one (outside the list rectangle) has no target and a release does nothing. Should the list rectangle have a tolerance (for example the hint and the heading)?
- **Q-FE2-05 (follow-up)** The shared menu has submenus now; "Move to" in the title bar menu could become one. Wanted?
- **Resolved:** Q-FE2-04 (implemented as proposed), Q-FE2-06 (File > Close window asks now, see decision 3).

---

## Implementation notes (part B2b: tasks 22-25 and 28, REV-006, 2026-10-16)

The Write dialog, profiles v2, the shortcut maps, the traffic UI finish and the jsdom side of performance and accessibility are done, together with the findings of REV-006. Test counts: 105 files and 2479 tests (part B2a ended at 89 files and 2186 tests). `pnpm typecheck`, `pnpm lint:web`, `pnpm test:web` and `pnpm build:web` pass. Not in this round: FE-003, pop out by drag (task 26), dock by drag (task 27).

### Layout of the code (new or changed)
- **22 Write:** `store/write.store.ts` (one store per window; `openFor(pollId, prefill)`, `getConfig(pollId)`), `store/write.logic.ts` (`writeDialogTitle`, `aliasLineFor`, `writePreviewFor`, `READ_ONLY_TOAST`), `runtime/write-flow.ts` (`openWriteDialog`, `watchWriteLink`), `components/dialogs/WriteDialogView.tsx` (shown by `PollDialogs` in W1 and by `NativePollWindow`). `hostActions.write(address | null)` in both hosts: a row address (Enter, double click, row menu) gives the read-only toast for FC02 and FC04, `null` (toolbar, `⋯` menu, `Ctrl+E`) prefills from the focused row or the poll start. The dialog holds a modal lock on its window's layout store.
- **23 Profiles:** `runtime/profile-flow.ts` (Save, Save as, Open, load, notice, relay), `store/profile.logic.ts` (`contentSignature`, texts), `store/profile-info.store.ts` (name, `modified`, `baseline`, `migrated`), `store/confirm.store.ts` and `store/dialogs.store.ts` (restored from the legacy window), `components/dialogs/OpenProfileDialog.tsx`, `SaveAsDialog.tsx`, `ConfirmHost.tsx`, `components/shell/MigrationNotice.tsx`. The File menu entries are live. `createConnectionRuntime({ saveProfile })` is now only an override: the Save button of "Save changes?" calls the profile flow.
- **24 Shortcuts:** `lib/shortcuts.ts` (more suppressed browser keys; a binding whose `when()` is false lets the key through unless a browser uses it), `runtime/poll-view-shortcuts.ts` (`Ctrl+1..4`, `Ctrl+B`, `Ctrl+Shift+V`, `Ctrl+E`, shared by both hosts), `components/shell/use-shortcuts.ts` (the W1 map with `scopedSubWindow`), `components/native/use-native-shortcuts.ts` (the W2 map), `components/shell/use-regions.ts` (`NATIVE_REGION_ORDER`).
- **25 Traffic:** the panel and bar were finished in B1; this round adds the tests of the filter, the counters, the empty texts, the expanded state and "Show traffic for this poll" (`TrafficFilterUi.test.tsx`).
- **28:** `components/A11y.test.tsx`, `components/Performance.test.tsx`, `app/contrast.test.ts`, `components/shell/ShortcutMaps.test.tsx`.
- **Fake:** `holdReply(method)` runs the effects of a command and holds only its answer (the real order of events and reply); a write frame now carries `origin.pollId`.

### How "Modified" works (DES-002 6.1)
The saved content (connection draft, "Start polling when connected", and per poll: name, definition, display, scale, overrides, value columns, aliases) is serialized into a signature, polls sorted by id so the list order does not count. `active`, hosts, rectangles, workspace settings and the traffic filter are not in it. `profileInfo.modified` is true when the signature differs from the baseline (the first snapshot, a load or a save). A poll that is added and deleted again is not a change. The signature is only recomputed when a poll config object, the draft or the auto-start flag changed, never on a counters event.

### Decisions and deviations (none against the design text; points the tasks left open)
1. **Load applies the snapshot of `mm_apply_profile`.** The window pauses list syncing while the command runs, so no sub-window is mounted at a default rectangle and reported to Rust over the layout of the profile. Tile mode re-tiles the loaded rectangles (DES-002 6.3), so a round trip with tile mode on is stable but not deep-equal for the tiled rectangles.
2. **Save as with an existing name** asks Replace only after the backend answered `profileExists`; Save overwrites (the profile may have been renamed or deleted in another window). A `SaveRequested` from W2 brings W1 to the front (`mm_focus_connection_window`) only when something is shown: Save as, or the "Fix the highlighted fields" toast.
3. **Alias line in the Write dialog** shows only when the start address has an alias (Q-FE2-14).
4. **Scaled preview:** `writePreviewFor` and the line in the dialog exist; the default provider returns nothing, so the line stays hidden until FE-003 passes `createScaled`.
5. **W2 `Ctrl+Shift+N`** tries "Poll 1", "Poll 2", ... until Rust accepts the name, because a native window knows no other names. A new native poll does not focus its Name field (the window cannot tell it is new).
6. **`aria-label` of a sub-window** is "{name}, {pill}, sub-window" (DES-002 2.12); section 9 of the same document leaves out the last part (Q-FE2-15).
7. **DOM order of the sub-windows** stays by poll id: moving a focused node in the DOM (to put the front window first) would drop its focus on every raise. `Ctrl+F6` and `F6` are the routes. DES-002 9 says "in z-order from the front" (Q-FE2-16).
8. **`biome.json`:** no change was needed.

### Small items (PM)
(a) a list drag released within 16 px above the first row or below the list still targets the list (`listDropZone`, `LIST_DROP_TOLERANCE`); (b) "Move to" in the title bar menu is a real submenu (and "Pop out to own window" is a top-level entry again, REV-006 n-2); (c) the arrange entries are named Tile, Side by side, Stacked, Cascade as in DES-002 (unchanged).

### REV-006 findings
Fixed: **M-1** (the sub-window stays, with its spinner and last values, until the pop out command answers; a failed pop out gives the frame a new view that attaches again and gets its handoff back, `views.refresh`; the tests use `holdReply` and fail against the old behavior), **m-1** (`pending` is set before the layout report, also for Keep without asking), **m-2** (the gesture listens on the document and ends when the poll goes: `drag.abort`), **m-3** (a reorder finds the moved poll by id), **m-4** (announcements come after the command and only on success; a native drop says "docked" itself; in tile mode the order changes after a successful dock), **m-5** (a window without a config, detached or removed closes with the OS close), **m-6** (slots come from the tiled windows, one selector), **m-7** (the focus waits for the grid after a dock or Show; after Keep, Delete or pop out it goes to the active sub-window or the poll list), **m-8** (a failed pop out is remembered for 2 s: its host change back is no dock), **m-9** (rows, rail icons and pills select narrow slices; the tooltip is built on hover; `PollListRenders.test.tsx`), **m-10** (the four regression tests in `Rev2Regressions.test.tsx`, plus the RTU hand-edited load), **m-11** (`HOST_ALLOWED`, `lastUnexpected`, a development warning), **n-1** (keyboard Size snaps and stays inside), **n-2**, **n-3** (tile mode reports the new rectangles after an unmount), **n-4** (rollback to the order Rust confirmed), **n-5** (Next and Previous need two visible sub-windows), **n-6** (z renumbered above 10000), **n-7** (the Esc click swallower expires after 1 s), **n-8** (a second close request while the question is open is answered "cancel"), **n-9** (the row `⋯` is not a tab stop, Left and Right move between the title bar buttons; `aria-hidden` was not added because a focusable element must not be hidden), **n-10** (disabled menu entries are reachable by keyboard with their title).
Not fixed: none. A very late channel event outside the 2 s window of m-8 can still be announced out of order (the risk the reviewer listed).

### Not verifiable in jsdom (needs a real window or WebView2)
Focus rings and fonts; the real tab order across the browser chrome (the DOM order and the roving tab stops are tested); `reading-flow`; screen reader output (the live regions' text and roles are tested); real pointer capture and drags with a mouse, pointer events leaving the window, the `lostpointercapture` that the document receives when a captured element is removed (the synthetic events are tested); `Ctrl+Alt+Arrow` and graphics drivers (R6), Alt and the Windows system menu (R7); layout, `ResizeObserver` sizes and container queries; the clipboard permission; whether `Ctrl+S`, `Ctrl+O`, `Ctrl+N`, `Ctrl+E` and `F6` reach the page in WebView2 before the browser handles them; long tasks over 50 ms with 8 polls at 100 ms (CHK2-Q1 to Q4), drag performance for 30 s, memory over 10 minutes; 8 polls in W1 together with 4 native windows; `mm_apply_profile` against the real backend (window creation, placements on missing monitors); the order of `Channel` events and command replies on a failed pop out; real `profiles_*` files (migration of a schema 1 file, unreadable rows).

### Capabilities
No new permission: Save as, Open, the relay of a native `Ctrl+S` (`mm_request_save`), `mm_focus_connection_window`, `mm_apply_profile`, `mm_export_profile` and `profiles_*` are commands, and `Ctrl+N` in a native window uses `window_open_tool` like the launcher. The window calls stay `setTitle`, `onCloseRequested` and `destroy`.

### Questions for the designer
- **Q-FE2-14** Write dialog alias line for FC15 and FC16: the design says "the alias of the start address plus (+{n} more with aliases)". When the start address has no alias but a later one has, there is no line. Show "(+{n} more with aliases)" alone?
- **Q-FE2-15** DES-002 2.12 gives the sub-window the name "{name}, {pill}, sub-window" and section 9 gives `aria-label="{name}, {pill}"` with `aria-roledescription="sub-window"`. Implemented: 2.12. Which one is right?
- **Q-FE2-16** DES-002 9 asks for the tab order of the sub-windows "from the front". The DOM order is by poll id (a moved focused node loses its focus). Accept `Ctrl+F6` as the route, or should the front window be the first tab stop (needs `reading-flow` or another focus model)? **Closed (revision 8, D-002-08):** DOM order by poll id is the design; `Ctrl+F6` and the sidebar are the routes; Tab into a sub-window activates it (task 29c).
- **Q-FE2-17** A new poll created from a native window (`Ctrl+Shift+N` there) opens its window without the focus in Name. Should Rust tell the window it is new (a query parameter)?
- **Q-FE2-18** Loading a profile with unapplied poll edits in some views closes them without asking (DES-002 6.3). Only the profile's own unsaved changes ask. Should "Save changes?" mention unapplied edits, as the window close does?
- **Answered by this round:** Q-FE2-05 ("Move to" is a submenu), Q-FE2-13 (16 px tolerance). Still open: Q-FE2-07 to Q-FE2-12.

## Implementation notes (REPORT-003 fixes)
2026-10-17. Frontend only. Covers the product findings of REPORT-003 and task 29 (a to g), DES-002 revision 8.

### Fixed
- **29g / CHK2-F1, F2 (scroll).** `DataGrid.tsx`: the effect that scrolls the focused row into view ran right after the restore effect on mount. With `align: "auto"` and the virtualizer's offset still 0 (the first scroll had not been reported yet) it wrote `scrollTop = 0` and undid the restore. Now the restore remembers the focus and range it was made for (`restoredFor`) and the focus effect skips exactly that state; a later focus move scrolls the row into view as before. `DataGridScroll.test.tsx` reproduces QA's handoff in jsdom (the virtualizer needs `scrollHeight`, `clientHeight` and `scrollTo`, which the test supplies) and fails on the old code for focus only, focus inside the viewport, focus at 80 and "moves later".
- **29a / CHK2-E12 (dock at 640).** `PollView` takes `frameInset` (the horizontal border its frame adds: `SubWindowFrame` passes 4 px active, 3 px inactive) and decides the presentation on measured body + inset, which is the frame width, also while a resize drag is live (the committed rectangle is only updated when the drag ends, so `item.rect.width` as the task suggests would lag). 640 -> dock, 639 -> popover, 900 -> dock, 600 -> popover for both borders; a draft survives 640 -> 639. W2 has no frame (inset 0). Deviation from the wording of 29a only in the source of the width (measured + inset, not `item.rect.width`); the vectors are the same.
- **29b / CHK2-E13, E16-E19 (status line).** Replaces the part A container queries and my first estimate-based fit. `lib/status-line.ts` has `statusLineSteps(L)`: below 700 the freshness chip is icon only, below 620 the reason is hidden, below 580 `ID`/`F` are hidden, below 480 the Show control is `columns-3` + chevron (name and tooltip "Show {Both}"). `L` is the poll view width (frame - 4 active, - 3 inactive). The reason and the `ID`/`F` segments are hidden with the `hidden` attribute (still in the DOM; the line's `aria-describedby` still points at the reason). The left group (state chip, counters, reason) is `min-w-0 flex-1 overflow-hidden`; the controls sit in a `shrink-0` group, so they never clip; the counters span is `min-w-0 truncate` with its full text as `title` (final safety). `data-step` (0 to 4) on the status line says how many steps are on. Vectors 719/700, 699, 620/619, 580/579, 480/479 are unit tests. **The widths are estimates and jsdom cannot lay out text: the CHK2 E16-E19 fit checks decide whether any step must move.**
- **29c / CHK2-R1, R6.** `SubWindowFrame` `onFocusCapture` activates and raises the sub-window when focus enters it (`workspace.activate`, which reports nothing). DOM order stays by poll id. **Tab order of sub-windows stays DOM order by poll id (D-002-08); CHK2-R1 is rewritten by QA: reach a sub-window with `Ctrl+F6`, the sidebar list, or Tab (which now activates it).** One existing test (`WorkspaceDrag`, "the workspace background forwards the keys to the active window") focused the title bar of the non-active window and expected the other window to move; it now leaves the focus alone.
- **29d / CHK2-I22 (snap ties).** `lib/drag-math.ts`: lines at the 8 px gap are marked `gap`; at equal distance the order is tile-area edge, then a touching edge, then a gap line, then the higher z. Unit vectors in `drag-math.test.ts` (an edge 4 px from B.left and B.left - 8 snaps to B.left; guide on the touching edge).
- **29e / CHK2-G6 (S6 sentence).** `closeDialogBody(name, { hasUnappliedEdits, polling })`: `polling` is `isPollRunning(state)` (polling, timeout, exception, badResponse), in both hosts. Offline and paused polls never get "A kept poll keeps polling in the background." even with the run intent on.
- **29f / CHK2-B5, C2.** No UI change. The fake follows `active = autoStartPoll` for a duplicate (new-poll rule): polling when auto start is on and the link is up, paused when auto start is off, offline while the link is down (tests in `modbus-master.fake.hooks.test.ts`). The W1 title keeps " *" when Modified (`Shell.test.tsx`).

### Hooks for QA (REPORT-003 section 5) and how to read them
1. `data-slot="setup-dock" | "setup-popover" | "setup-panel" | "setup-rail"` on the surface element only (the aside, the dialog, the rail button). The group keeps `data-slot="poll-view"` and `data-presentation`.
2. Native window: `data-ready="true"|"false"` on `[data-native-window]`, true when the close handler is registered and the attach has finished (also when the attach failed, so the window can be closed).
3. Fake: `nativePlacement(pollId)` (copy or null). `setWorkspaceLayout` sets `compact` only while no session has been opened and `setCompactMode` was never called (seeding before boot); otherwise `compact` stays Rust's, which `modbus-master.fake.contract.test.ts` pins ("compact inside the workspace layout is ignored") and which the real backend does. `linkMonitors(a, b)` (exported from `shared/ipc/window.ts`) makes the window IPC and the Modbus fake share one monitor list; `createIpcRuntime` links them, and assigning `monitors` on either changes both. Persistence: `createFakeModbusMasterIpc({ persist: { storage, key? } })` keeps polls, hosts, rectangles, layout, preferences, profile name and profiles (not the connection, values or counters); in the dev page, load it with `?fakePersist` in the URL or `VITE_FAKE_IPC_PERSIST=1` (stored in `sessionStorage`, one copy per page, so a reload keeps it and a second page has its own).
4. `data-prefs` on `[data-native-window]`: JSON `{"askOnPollClose":true,"compact":false}` as the window applied them (snapshot and `PrefsChanged`).
5. `data-cell="seq|time|dir|len|bytes|info|poll"` on the cells of the traffic panel rows.
6. Render probe: in dev builds `window.__ESEFACT_RENDERS__` has `get(key)`, `all()`, `reset()`; the key of a poll view is `poll-view:{pollId}` and it counts the commits of the view body (not of its rows). In a production build it is off (`import.meta.env.DEV`): nothing is installed and `record` does nothing.
7. Announcements: `data-seq` on `[data-testid="live-polite"]` and `[data-testid="live-assertive"]` (the sequence number of the announcement the region holds, 0 when empty; a repeated text gets a new number), and the fake window IPC logs every announcement: `window.__ESEFACT_FAKE_WINDOW_IPC__.announcements` is `[{ text, assertive }]`, oldest first, at most 500.

### Not fixed / open
- The status line steps and the dock threshold are verified in jsdom through the width the view reports, not with real text metrics or a real frame border; the CHK2 E12 and E16-E19 runs in a browser decide.
- The mechanism for `compact` in the fake is narrower than "always" on purpose (see hook 3).
- Questions for the designer: none new.

## Implementation notes (REPORT-004 fixes)
2026-10-17. Frontend only. Task 30 (a to d), DES-002 revision 9 (D-002-16 to D-002-18), CHK-002 revision 9.

### Fixed
- **30a / status line steps 0..5 (CHK2-E16 to E26).** `lib/status-line.ts`: pure `statusLineStep(L, freshness: "live" | "long" | "none"): 0..5` and `counterText(fields, step): { visible, full }` (plus `freshnessTextKind(chipKind)`: `live` for "Updated ...", `long` for every other text, `none` without a chip). L = status line width (the PollView width); strictly below is on, cumulative; `data-step` = the result:

  | step | L below | what changes |
  |---|---|---|
  | 0 | - | everything shows |
  | 1 | 720 (`live`, `none`) or 810 (`long`) | the freshness chip INSIDE the line is icon only (it is in the line only when L < 720, so there it is always icon only; at 720 <= L < 810 with a long text the step is 1 and nothing visible changes) |
  | 2 | 620 | the reason text is hidden (`hidden`, still in the DOM and still the line's `aria-describedby`) |
  | 3 | 606 | `ID` and `F` are dropped from the visible counters |
  | 4 | 500 | the Show control is icon only (`columns-3` + chevron, name and tooltip "Show {Both}") |
  | 5 | 465 | `Err {n}` is dropped too: `Tx {n} · SR {ms} ms` |

  The counters element is `data-slot="counters"` (`data-testid="status-counters"`), its text is `visible`; its `title` is always `full`, and from step 3 it is also a labelled group with `aria-label = full` (accessible name = complete text). The reason element is `data-slot="reason"`. Layout: no spacer and no wrapper; the strip holds the state chip (`shrink-0`), the counters (`min-w-0 truncate`, the end ellipsis stays), the reason (`flex: 1 1 0; min-width: 0`, the only growing item) and the right group (`ml-auto shrink-0`: freshness chip, Show, `⋯`). The data card header freshness chip is not given the step and keeps its full text (component test at L 720, 760, 809, 810, 900). Reference frames (active frame - 4): 640 = step 1, 600 = 3, 560 = 3, 430 = 5. Unit vectors in `status-line.test.ts` (every boundary, live/long/none, `counterText` at steps 0 to 5 and with `(effective 180 ms)`), DOM tests in `PollView.test.tsx`.
- **30b / setup threshold from the frame's `offsetWidth` (CHK2-E12).** `PollView` takes `frame` (a ref to the host's frame element; `SubWindowFrame` passes its `<section>`); `useFrameWidth` (`poll-view/context.tsx`) reads `offsetWidth` from a `ResizeObserver` on the frame (border box) coalesced to one update per animation frame. `frameInset` and the `FRAME_BORDER_*` constants are removed. Before the first measurement, and in W2 (no frame), the view width decides (W2 unchanged). Vectors 900, 641, 640 -> dock; 639, 600 -> popover for an active (body = frame - 4) and an inactive (body = frame - 2) frame; the draft survives 640 <-> 639; activating another sub-window never changes the presentation (`PollView.test.tsx`, `SubWindowPresentation.test.tsx`).
- **30c / S6 snapshot (CHK2-G6).** `poll-host.store.ts` has `closeBody: { name, unappliedSentence, keepsPollingSentence } | null`, built once by `requestClose` through `closeSnapshot` (`poll-host.logic.ts`; the `describe` dep now returns `hasUnappliedEdits` and `polling` too) and cleared by Cancel and by the Keep/Delete answers. `ClosePollDialogView` renders `closeSnapshotText(closeBody)` and takes `present` (the poll still exists) instead of live details; the buttons act on the poll as it is when pressed. Both hosts use the same view. Store test: open S6 while polling, pause/rename/edit, the stored body is unchanged; cancel and reopen reads it again. Component tests in `PollDialogs.test.tsx` and `NativePollWindow.test.tsx`.
- **30d / hooks.** `data-step`, `data-slot="counters"`, `data-slot="reason"`. The fake has `freezePollCounters(pollId, { requests, errors, timeouts? })` (reference `Tx 1234`, `Err 0` / `Err 3`): it sets the poll's counters, keeps them from advancing while the poll keeps polling, tells an attached view at once, and `freezePollCounters(pollId, null)` lets them run again (reachable as `window.__ESEFACT_FAKE_IPC__.freezePollCounters` like the other fake hooks; tests in `modbus-master.fake.hooks.test.ts`).

### For QA (expectations that are now obsolete)
- `data-step` is 0..5; the old boundaries 704/703, 624/623, 584/583, 484/483 are replaced by L 720/719 (live), 810/809 (long), 620/619, 606/605, 500/499, 465/464 (frame = L + 4 when active). Frame 600 is step 3 (was 1-2); frame 430 is step 5 (was 4).
- The counters element no longer contains hidden spans: its text is exactly the visible text (`Tx n · Err m · SR ms` at steps 3 and 4, `Tx n · SR ms` at step 5), so `innerText`/`textContent` is the visible text; the complete text is the `title` (and the `aria-label` from step 3).
- Inside the status line the freshness chip is always icon only. The data card header chip (L >= 720) always has its text.
- S6: the text is fixed when the dialog opens (including the name).
- The status line has no wrapper around the chip, counters and reason any more: they are direct children of `[data-testid="poll-status-line"]`.

### Not done / open
- Real text metrics are QA's job (CHK2-E26 counters fit at frames 640/600/560/430); jsdom checks only which elements show at which L.
- Questions for the designer: none.

- **REPORT-005 F1 / exact status line width (no rounding).** `useElementWidth(reduce?)` (`poll-view/context.tsx`) no longer does `Math.round`: it measures the exact (fractional) width and stores `reduce(width)`, so state, and thus a render, changes only when the reduced value does. `PollView` passes `snapViewWidth` (`poll-view.logic.ts`: the largest of `VIEW_WIDTH_BREAKPOINTS` 465, 500, 606, 620, 640, 720, 810 that is `<=` the exact width, else 0), which answers every strict `<`/`>=` like the exact width: `statusLineStep`, `isWideHeader` and the native no-frame limit 640 (exact: 639.6 is narrower than 640); the dock/popover threshold keeps the frame's integer `offsetWidth`. `ScaleSection` passes `Math.round` (its "at or below 260" stacking is a whole-pixel layout limit, unchanged).
- Tests: fractional L 719.8/720.0/619.8/605.8/499.8/464.8/465.0/809.8 etc. in `PollView.test.tsx` (fail with the old rounding), `snapViewWidth` vectors in `poll-view.logic.test.ts`, and a render-count test (40 sub-pixel widths inside one band re-render the view 0 times; crossing a boundary re-renders).

## Implementation notes (REPORT-006 fixes)
2026-10-17. Frontend only (`apps/desktop/src`). Covers D4, D2 (frontend part), O1, O7 and O5 of `docs/qa/REPORT-006-integration-multipoll.md`.

### D4 - the first click on an action button is lost when a blur message moves it (fixed)
- Cause: the mouse press moved the focus to the button, the field blurred, its message appeared, the layout shifted and the release landed on something else, so no `click` was dispatched. It affected every action button that sits below a field that validates on blur, not only [Apply scale].
- Fix: `shared/lib/keep-focus.ts` exports `KEEP_FOCUS_ON_PRESS` (`onMouseDown` -> `preventDefault` for the primary button). The press no longer moves the focus, so the field does not blur, nothing moves under the pointer, and the click still fires and validates everything on submit (the first invalid field gets the focus, as before). The keyboard is unchanged (Tab still moves the focus to the button and blurs the field). Applied to: [Apply] (POLL section: Quantity, Start, ...), [Apply scale], Save profile as [Save] and [Cancel], the override dialog (S8) [Save] and [Cancel], the Write dialog [Send] and [Close]. Reviewed and not affected: the inline rename (its message is absolutely positioned and there is no button below it; a blur commits or reverts), the profile rename in the Open dialog (no blur validation), the connection form (its Connect button is in the toolbar, above the fields), the quick picks and segmented controls (they are meant to blur the field).
- Side effect to know: after a successful click on one of these buttons the focus stays in the last field instead of moving to the button.
- Tests (`shared/lib/press-test-utils.ts` `clickWithLayoutShift` presses on the button and, if the press made the page change - the blur message appeared - releases the pointer over that message instead of the button, as a real browser does when the button moved): `ScaleSection.test.tsx` (both hosts, Decimals `7` after an applied 4-20 mA scale), `PollView.test.tsx` (Quantity 200 + Apply), `ProfileDialogs.test.tsx` (Save profile as, empty name), `OverrideUi.test.tsx` (Decimals), `WriteDialog.test.tsx` (Slave ID 300 + Send), `keep-focus.test.ts`. All six component tests fail without `KEEP_FOCUS_ON_PRESS` (checked) and pass with it.
- Not verified: the real WebView2 mouse (jsdom has no layout; the shift is simulated by where the pointer is released). QA re-runs the CHK3 Decimals plain-click test.

### D2 - a lone Alt tap must not reach the host (task 31b; frontend part done, the OS behaviour NOT verified)
- `shared/lib/alt-guard.ts`: pure `createLoneAltTracker(): { keyDown(e), keyUp(e): boolean, blur() }` (the 31b vectors: Alt down/up -> true; Alt, ArrowRight, Alt up -> false; Alt, Space, Alt up -> false; Alt, blur, Alt up -> false; pointer input is never seen, so an Alt-drag ends with true; `AltGraph` counts as Alt), `createAltGuard()` on top of it, and `installAltGuard(win)` / `useAltGuard()`. The guard is installed by the app shell (`app/App.tsx`, so also the **launcher**) and, with a per-window reference count so it is never registered twice, by `ConnectionWindow` (W1) and `NativePollWindow` (W2) (their tests render the window without `App`). Rules:
  - keyup of `Alt` / `AltGraph`: `preventDefault` when the tracker says it ends a lone press, also in a text field;
  - keydown of `Alt` / `AltGraph`: `preventDefault`, except while a text field has the focus (Alt codes and AltGr characters). **Finding:** jsdom cannot show whether the keydown rule is needed to stop WebView2's menu mode (only the keyup rule is known to matter); I kept it as a second line of defence, QA can tell from CHK2-R7;
  - Alt with another key is never touched: `Alt+F4` (not prevented, tested), `Alt+Space` (unchanged), `Alt+Arrow` (moves the sub-window), Alt codes; the Alt keyup after a combination is not prevented;
  - nothing is stopped from propagating (`stopPropagation` is NOT used): the drag gestures read the Alt key events (Alt turns snapping off). The gesture-level `preventDefault` of Alt in `pointer-gesture.ts` and `list-gesture.ts` is kept; it only lives while a drag lasts, which is why the keyup after a drag was still reaching the host.
  - No ARIA or focus behaviour changes; screen readers do not depend on the default action of a lone Alt on the page.
- Tests: `alt-guard.test.ts` (tracker vectors, guard rules, text fields, Alt codes, install/blur/refcount), `app/App.test.tsx` (the shell installs it, Alt+F4 untouched, removed on unmount), `WorkspaceDrag.test.tsx` (W1: lone Alt and AltGraph tap, after an Alt-drag, Alt+Arrow still moves 16 px, Alt+F4 not prevented; snapping off with Alt still passes), `NativePollWindow.test.tsx` (W2: same, and a text field).
- **What I could NOT verify:** that the OS menu mode no longer starts. jsdom and the fake IPC only show that the `keydown` and `keyup` events of Alt are default-prevented; whether WebView2/Tauri then really swallows `WM_SYSKEYUP` needs hardware input (SendInput) on the real app. QA re-runs CHK2-R7 (a) to (g) together with the backend window-layer fix; if it still fails with the guard in place, the window layer is the cause (Q-002-17). Not checked: a release build, and plain `F10` (also an OS menu key; the app does not use it and I did not touch it).

### O1 - the native setup popover below 640 px (task 31a, done)
- `setupPresentationFor(host, width, open, compact = false, localOverride = false)` returns `"closed" | "dock" | "popover" | "panel" | "rail"` (the old `"none"` is now `"closed"`). Native: closed -> `rail`; open -> `panel` at >= 640, `popover` below. Compact mode closes the setup unless the window has a local override. Vectors (466, 626, 639 open -> popover, closed -> rail; 640 and 900 open -> panel; the compact rows of the task) are in `poll-view.logic.test.ts`. The popover state **is** the `setupOpen` flag (no second flag), so the handoff, a live resize and a PrefsChanged keep it: a poll popped out with its setup open arrives as the popover at 626, one popped out with the setup closed arrives as the rail (as in the QA repro).
- `PollView`: the rail (30 px) stays rendered while the popover is open; `aria-expanded` is true then and `aria-controls` points to the popover; its name stays "Show setup (Ctrl+\)" (the existing hook; `aria-expanded` carries the state). A click on the rail, `Ctrl+\` and the toolbar toggle call `toggleSetup()`; Esc inside the popover and [Done] call the new `closeSetup()`. The popover is 360 px wide, left edge at 30 px, top 36 px (under the status line), max height `calc(100% - 44px)`, scrolling inside; no outside-click close. On open the focus goes to the first `aria-invalid` field, else the first input (Name); on close the focus returns to the rail button. The rail shows an unapplied-edits dot (`data-testid="rail-unapplied"`, with an sr-only "Unapplied changes"). `data-region="setup"` is on the native popover (F6) and `data-ready` ("true" once the attach snapshot is applied) is on the poll view group (31d); the pop out button already has `aria-busy`.
- Tests: `poll-view.logic.test.ts`, `poll-view-ui.store.test.ts` (`closeSetup`), `PollView.test.tsx` (native hosts of 466, 626, 639: rail while closed, click, Esc and focus back on the rail, [Done], second click, toggle, invalid Quantity focus and message, a click on the data card keeps it open; 640 and 900: panel; a live 639 -> 640 -> 639 keeps the draft; compact mode; open arrival at 626), `NativePollWindow.test.tsx`.
- Existing expectations changed on purpose: a native window below 640 with its setup open is now the popover (before: the rail), in `PollView.test.tsx` and `NativePollWindow.test.tsx`.

### O7 - wording of the Save changes? dialog (task 31c, done)
- `saveChangesBody({ profileName, nativeWindowCount, unappliedPollNames, reason: "close" | "load" })` in `store/profile.logic.ts` (the three vectors of the task are tests); `windowCloseBody` (close) delegates to it, the load flow (`profile-flow.ts`) passes `reason: "load"` ("... before loading?"). The load flow gets the poll-window count and the names of polls with unapplied edits through a new optional dep `loadSummary` (from `connection-runtime.ts`), and now asks (like closing) when the profile is modified **or** a poll has unapplied edits, because a load discards both. That last condition is new behaviour; no existing test covered it. The load flow with a native window is covered by the vectors only, not by a flow test.

### O5 - Modified flag after a page reload (NOT done)
- "Modified" is a frontend rule (the signature of the content against the baseline taken at the last load or save, `profile-info.store.ts`). Rust keeps only the profile name, not the baseline, so after a reload there is nothing to re-derive it from, and the first content seen becomes the new baseline. Fixing it needs either a backend-held baseline or flag (a request to the backend) or persisting the baseline in the page (`sessionStorage`); I judged neither simple and safe enough for a case a user cannot reach (F5 is suppressed; only a CDP reload or a dev hot reload does it). Left as is.

### For QA to re-test with real input
- CHK3 Decimals `7` plain click on [Apply scale] (one click must show "Scale not applied. Fix the highlighted fields."), and the same pattern on Quantity + [Apply], Save profile as [Save], override [Save], Write [Send].
- CHK2-R7 (a) to (g) with hardware Alt (see D2), also an Alt-drag and the launcher window, together with the backend fix.
- CHK2-F14 at the native widths 466, 626, 639, 640, 900 (rail, popover, panel, compact, live resize, pop out with the setup open and closed).
- Question for the designer: none open. Notes: `"none"` became `"closed"` as in task 31a; the rail keeps the name "Show setup (Ctrl+\)" while the popover is open (`aria-expanded` says so); the load flow now also asks when only unapplied poll edits exist (31c).

### REV-008 m-3 - focus kept when a live resize crosses 640 px with the setup open (fixed)
- `PollView` captures the focused control of the setup container (dock, panel or popover) in a ref cleanup, which runs before the node is removed, and `setup-focus.ts` puts the focus back on the equivalent control after the move: the same field found by the stable part of its id (the `useId` prefix differs per instance) or by its position in the setup content, with the same caret or selection; the draft already lives in the UI store. The rail button and the panel's hide button count as one control; the popover's Done button has no twin, so the focus goes to the first field. The "first invalid field, else Name" focus now runs only when the popover is opened from the rail or at the start, not on a width change; the open state and the rail/popover aria (`aria-expanded`, `aria-controls`, `role="dialog"`, `aria-modal="false"`) are unchanged. Same rule for the sub-window dock/popover switch at the frame width 640.
- Tests: `PollViewFocus.test.tsx` (native 639 <-> 640 and sub-window frame 639 <-> 640: field, selection and direction, an invalid sibling field not stealing the focus, select, SCALE field, focused rail <-> hide button, open and closed state, aria after each switch, focus outside the setup untouched, focusName not re-applied by a resize).

## Implementation notes (REPORT-007 fixes)
Task 32 a, b, c, d (D8, D6, D7 focus side, D9). Frontend only; no Rust, e2e, CHANGELOG or other docs touched.

### 32a - shortcuts on every layout (D8, done)
- `shared/lib/shortcut-key.ts` (pure, one place): `shortcutKey(e): string | null` with the exact input and rules of the task (IME, "Process", "Dead", "Unidentified" -> null; `Digit0-9` code -> the digit on every layout, keypad digit by `key`; ASCII letter -> lowercase; one non-ASCII non-Latin character with `KeyA-Z` -> the code letter; Latin letters with diacritics and ASCII punctuation -> null; named keys -> `key`; AltGr (`altGraph` or Ctrl+Alt) -> null for letters and digits, `Ctrl+Alt+Arrow` kept). `isNativeTextEdit(target, k, e)` as specified (it also covers email, url, tel and password inputs, which are text too). Adapters: `shortcutKeyOf(domOrReactEvent)`, `keyInputOf`.
- **Addition (Q-002-19 decision):** `punctuationKey(e)` is a second pure function for the punctuation shortcuts `Ctrl+\`, `Ctrl+Shift+\` and the existing `Ctrl+Shift+|`: the ASCII mark the layout types, or `\` for the physical `Backslash` on a non-Latin layout. `comboKeyOf(e) = shortcutKey ?? punctuationKey` is what `matchesCombo` compares (lowercase). `shortcutKey` itself returns null for punctuation, as specified.
- `lib/shortcuts.ts`: `matchesCombo` uses `comboKeyOf`; `createShortcutHandler.handle` first returns false (no handler, no `preventDefault`) when `isNativeTextEdit` says the event is a native editing key of a text field. The remaining letter compares were replaced: `PollList` Ctrl+C, `DataGrid` Ctrl+A and Ctrl+C, `TrafficPanel` Ctrl+C. F6 (`use-regions.ts`), F2, arrows, Enter, Esc and Delete are named keys and never depended on the layout. There is no letter shortcut in the launcher, in `alt-guard`, in the drag code or in Rust (`key_menu.rs` only handles a lone Alt and F10), so nothing else needed changing.
- Tests: `shortcut-key.test.ts` (every CHK2-R12 row, the extra vectors of the task, all KeyA-Z and Digit0-9, punctuation, adapters, `isNativeTextEdit`), `shortcuts.test.ts` (Thai, Cyrillic, Dvorak, AZERTY, AltGr, IME at matcher and handler level, text-field early return, Backslash), `ThaiLayout.test.tsx` (component level in W1 and in a native window: Ctrl+P, Ctrl+Shift+P, Ctrl+L/N/J/O/S/E/B/A/C/1-4, Ctrl+Shift+N/T/C/O/D/S/M, Ctrl+\ and Ctrl+Shift+\, F6; Russian; Dvorak physical P = Ctrl+L and Dvorak "." on KeyE does nothing; AZERTY digit row and Ctrl+A; Process and Dead; Thai typing and Ctrl+C/V/X/A/Z in a field are not prevented; AltGr).
- Dvorak as the PM said: the Dvorak physical P key (types "l") is Ctrl+L, a disconnect in W1.

### 32b - no document scrollbar, one-line status bar (D6, done in jsdom; the real layout is QA's)
- `styles.css`: `html, body, #root` are `height: 100%; overflow: hidden`. The W2 root (`NativePollWindow`) and the W1 root (`ConnectionWindow`) are `overflow-hidden`; the W2 cell around the PollView is `min-h-0 min-w-0 flex-1 overflow-hidden`; the launcher scrolls inside its own `h-full overflow-y-auto` box. Only the grid, the setup panels and the popover scroll inside themselves. The W2 toolbar still wraps (`flex-wrap`, `shrink-0`).
- Both status bars (`NativeStatusBar`, W1 `StatusBar`): `h-7 shrink-0 gap-4 overflow-hidden whitespace-nowrap`; the text is `min-w-0 flex-1 truncate` (ellipsis); `AppVersion` is now `shrink-0 whitespace-nowrap` itself. **Not as in my first brief:** the version label is not hidden below a width, because the designer's rule (task 32b) keeps it and lets the text take the squeeze.
- `shared/lib/use-truncation-title.ts`: `useTruncationTitle(ref, fullText)` sets `title` only while `scrollWidth > clientWidth` (layout effect, re-run when the text changes). Tests: (200, 100) sets it, (100, 100) does not, a text change updates it, a fitting new text removes it.
- Tests: `NativePollWindow.test.tsx` ("the page never scrolls"), `StatusBarLayout.test.tsx` (W1), `app/page-fit.test.ts` (the CSS rule).
- Evidence read: `e2e/test-results/evidence/d6-native-min-width-normal.png` shows the wrapped status text and version of the old layout. **QA must verify in the real window (CHK2-F17):** at every native width from the minimum (582 x 353 physical = 465.6 x 282.4 css px at 125 %) upwards: no scrollbar, `document.documentElement.scrollHeight` equals `innerHeight`, the PollView `offsetWidth` equals the client width, the status text is one 18.8 px line with an ellipsis (the title shows the full text when cut), the version label is one 16 px line. Also W1 at its minimum and the launcher. Open point: at the minimum height the toolbar takes three wrapped rows, so only a few grid rows show; that is the accepted "toolbar may wrap".

### 32c - Show traffic from a native window, W1 side (D7, done; raising W1 is the backend's)
- `traffic.store`: `focusRequest: "filter" | null`, `requestFilterFocus()`, `clearFocusRequest()`. `TrafficPanel` focuses the Filter select once when the request is set and no modal is open (`layout.modalOpen`), else keeps the request until the modal closes. The `expanded` flag and its height live in the workspace store (as before), so `showTrafficFor(id, { focusFilter })` is the runtime action (`ConnectionRuntime.actions`) that sets the filter, expands (height kept) and sets the request; it is not a method of the traffic store as the task names it (it needs two stores).
- The `ShowTraffic` payload has only `pollId` (no origin): `focusFilter` is true when `document.hasFocus()` is false as the event arrives (the fallback the task allows). **Risk for QA (CHK2-K5, K8 b):** if the backend raises and focuses W1 before the event is delivered, `hasFocus()` is true and the select is not focused. Please ask the backend to add an origin field, or to send the event before it raises W1.
- Tests: `traffic.store.test.ts`, `TrafficFilterUi.test.tsx` (focus after the event from a native window, no focus when W1 had it, `showTrafficFor` with and without `focusFilter`, waits for a modal and takes the focus when it closes, expanded height kept).

### 32d - focus after a failed pop out or dock (D9, done)
- Pure `focusTargetAfterFailure(origin, host)` and `fallbackFocusTarget(host)` in `store/poll-host.logic.ts` with the eight vectors of the task (plus the native menu rows). `CommandOrigin` is passed by every start path: button, `Ctrl+Shift+O` and `Ctrl+Shift+D` ("shortcut"), status-line menu ("subWindowMenu"), sidebar menu, title bar menu; "dragOut" exists in the type only (there is no drag out in the code).
- The pop out button (`TitleBar`) and the native Dock button (`NativeToolbar`) use `aria-busy="true"` and `aria-disabled="true"` while pending, never `disabled`, so they keep the focus; a second press while busy does nothing. (The Dock button keeps `disabled` while the poll is not loaded.)
- `lib/focus-after-failure.ts` (DOM helper) records the focused element before the command and, after a failure, focuses the target when the focus is free (nowhere, or inside this poll's window); a control the user went to meanwhile keeps the focus. Fallback: the title bar (sub-window) or the first toolbar button (native: the poll name is not focusable). A grid that was focused is asked for again through the new `workspace.requestFocus(id)` (the new view's grid takes it once it attaches). `connection-runtime.popOutPoll(id, origin)` and `native-poll-runtime.dock(origin)` call it; W1 repeats it after a macrotask because the frame renders a new view.
- Tests: `poll-host.test.ts` (vectors), `workspace.store.test.ts` (`requestFocus`), `PopOutFocus.test.tsx` (button, shortcut from the grid and from another control, sub-window menu, title bar menu, sidebar menu, focus that moved meanwhile), `NativePollWindow.test.tsx` (button keeps the focus while busy, Ctrl+Shift+D from the grid, status-line menu, focus moved meanwhile), `PopOutButtons.test.tsx` updated to `aria-disabled`.
- jsdom cannot show what WebView2 does with a focused control that becomes `disabled`; with `aria-disabled` that case no longer exists. QA re-runs CHK2-F8 and F16.

### What QA must re-test with real hardware
- Thai (Kedmanee), Russian, French AZERTY, US Dvorak and German QWERTZ with `SendInput` scan codes: CHK2-R8 to R11 and M7; record `key` and `code` for Ctrl+P. Includes `Ctrl+\` and `Ctrl+Shift+\` on the Thai layout, `Ctrl+C/V/X/A/Z` in a Name field and Ctrl+C in the grid, AltGr+Q/E on German.
- CHK2-F17 and the D6 sweep in a real native window narrowing down to the minimum; W1 at its minimum; the launcher.
- CHK2-K5 and K8 (b): the Filter select has the focus in W1 after "Show traffic for this poll" from W2 (see the `hasFocus()` risk).
- CHK2-F8 and F16: failed pop out and dock (hooks build), with the button, `Ctrl+Shift+O` and `Ctrl+Shift+D`, and the menus: the focus is never on BODY.
- Questions for the designer: none open. The `showTrafficFor` placement (runtime action, not a traffic-store method) and the missing origin in `ShowTraffic` are noted above.

## Implementation notes (REPORT-008 partial fixes)
2026-10-17. Task 33 a and b (D8b, D10). Frontend only (`apps/desktop/src`); no Rust, e2e, CHANGELOG or other docs touched except this section. Not verified in a real window: see the end of this section.

### 33a - Backslash shortcuts by physical key (D8b, done in jsdom; hardware is QA's)
- `shared/lib/shortcut-key.ts` `punctuationKey(e)` now follows DES-002 3.1 "Backslash shortcuts" in this order: (1) IME (`isComposing`, `key` "Process", "Dead", "Unidentified") -> null; (2) AltGr (`altGraph`, or Ctrl and Alt both held) -> null on every `code`; (3) `code` "Backslash" -> `\` without Shift and `|` with Shift, whatever `key` is ("+", "ฃ", "ฅ", "#", "*", "µ", "/", "ё", even a letter); (4) `key` `\` or `|` on any other `code` -> that mark (UK `IntlBackslash`); (5) any other ASCII mark unchanged, ASCII letters and digits and other characters null.
- `comboKeyOf` asks the Backslash key first (`code` "Backslash" -> `punctuationKey ?? shortcutKey`); every other key keeps `shortcutKey ?? punctuationKey`. So the rule is "before the letter rules", and the letter and digit vectors of task 32 a are untouched (AZERTY "&" on `Digit1` is still Ctrl+1: the Backslash check is on `code`, not on the ASCII mark).
- Consequence to know: Ctrl+Shift+Backslash is now always the bar `|` (it was `\` on non-Latin layouts). Both windows already bind `ctrl+shift+\` and `ctrl+shift+|` to compact mode, so the behaviour is the same. Trade-off of rule 3: a layout that puts a letter or another mark on that physical key (Spanish "ç", German "#", AZERTY "*") also gets Ctrl+\ there, which is the only no-AltGr way those users have. German `\` is AltGr+ss (`key` `\`, `code` Minus, Ctrl+Alt): rule 2, no shortcut, the character types in fields.
- Tests: `shortcut-key.test.ts` (the 18 vectors: US, US Shift, Thai "+", Thai "ฃ", Thai Shift "ฅ", German "#", German Shift "'", German AltGr+ss as Ctrl+Alt and as the AltGraph state, AZERTY "*", AZERTY Shift "µ", AZERTY AltGr+8, Russian "\", Russian Shift "/", UK IntlBackslash plain and Shift, Ctrl+Alt on Backslash, IME "Process"; plus a letter, digit or diacritic on Backslash, AltGr and IME winning, marks on other keys, the letter and digit vectors unchanged), `shortcuts.test.ts` (handler level with the real bindings: six Ctrl layouts, five Shift layouts, AltGr not prevented, no Ctrl, "ç", UK IntlBackslash, AltGraph through `getModifierState`, "Process" and `isComposing`), `ThaiLayout.test.tsx` (W1 with focus in the sidebar list: Ctrl "+" collapses the sidebar and Ctrl+Shift "ฅ" is compact mode; focus in a sub-window grid: Thai "+", German "#", AZERTY "*" toggle that sub-window's setup and not the sidebar; AltGr does nothing; W2: "+" toggles the setup panel, Ctrl+Alt does nothing, "ฅ" is compact mode). The Thai table of the harness now uses what hardware really sends ("+" with Ctrl).
- CHK facing: CHK2-R8 and R12 (the 18 backslash vectors) can use these tests as the expected table. The real `key`/`code` pairs on hardware stay QA's (Thai Kedmanee and US are installed on the QA machine; German, AZERTY and Cyrillic are not, so their rows are jsdom-only).

### 33b - W2 toolbar squeeze (D10, done in jsdom; the real rows and grid height are QA's)
- Pure `components/native/native-toolbar.logic.ts`: `TOOLBAR_ICON_ONLY_BELOW = 640` (the one place to move it), `toolbarLabelMode(clientWidthCss): "full" | "icon"` (>= 640 full, below icon; vectors 900, 700, 640 full; 639.9, 560, 520, 466, 465.6 icon), `snapToolbarWidth` (exact width -> 640 or 0, so the toolbar re-renders only when the threshold is crossed, same idea as `snapViewWidth`), `toolbarLayoutFor(mode)` (the classes).
- Width source: `NativeToolbar` measures its own element with `useElementWidth(snapToolbarWidth)`. The toolbar is a full-width block of the window root, so its width is the window client width (the same number as the PollView width that decides the setup rail; there is no scrollbar since D6). Before the first measurement the width is 900 (`full`), so a real window may show one frame of full labels before the first ResizeObserver tick.
- `icon` mode (below 640): Pause or Resume (`pause` / `play`), Write… (`file-pen-line`), Connection window (`app-window`), Dock to workspace (`square-arrow-down-left`, `loader` while pending) are 32 x 32 `Button size="icon-sm"` (new size in `shared/ui/button.tsx`, `size-8 px-0`, same outline tone, pill radius and focus ring); `aria-label` and `title` are exactly "Pause" / "Resume", "Write…", "Connection window", "Dock to workspace"; the menu button keeps "Poll window menu". New icons in `shared/ui/icon.tsx`: `play`, `file-pen-line`, `app-window`. The pills (poll state and connection) keep icon and visible text. `full` mode (>= 640) is as before: text, titles with the shortcuts (`Pause (Ctrl+P)`, ...), 60 px minimum; `aria-disabled` and `aria-busy` on Dock are unchanged in both modes.
- Two deliberate deviations from the letter of the task: (1) the toolbar's direct children are two groups (`data-slot="toolbar-main"`: name, pencil, poll state pill, Pause, Write…; `data-slot="toolbar-connection"`: connection pill, Connection window, Dock, menu), each a non-wrapping row, instead of a flat list of items. A flat `flex-wrap` can produce a third row (a long name pushes Write… alone to a new line and the connection items wrap again); with the groups the toolbar has at most two rows at every width in both modes, and "rows = distinct offsetTop of the direct children" can only give 1 or 2. Row 1 is the main group, row 2 the connection group, as the design intends. (2) In icon mode the disabled Write… keeps its reason as `title` ("Not connected. Connect before writing.", DES-001 2.5) instead of the bare name; connected, the title is exactly "Write…". The poll name has `min-w-20` (80 px), `truncate`, `max-w-48` in icon mode (`max-w-64` in full) and its `title` is the full name only while cut (`useTruncationTitle`, new `PollName`).
- Icon mode toolbar: no minimum height, `px-3 py-1`, `gap-x-2 gap-y-1`. Full mode unchanged (`min-h-[60px]`, `px-4 py-2`).
- Structural numbers (derived, not measured): a button row is 32 px. Icon mode: one row 40 px, two rows 8 + 32 + 4 + 32 = 76 px. Full mode: at least 60 px, two rows 84 px. REPORT-008 measured the old three-row toolbar at 120 px (16 + 3 x 32 + 2 x 4), the PollView at 134.4 px and the grid at 65 px with 282.4 css px of client height (282.4 - 28 status bar - 120 = 134.4, so 69.4 px of the PollView are not grid). At 465.6 css px the toolbar is always two rows: the main group is about name + 211 px and the connection group about 260 px against 441.6 px of content width, so they never share a row, and each fits its own row for any name up to 231 px (the cap is 192 px). With 76 px: PollView 178.4 px, grid about 109 px (+44 px). Data rows are 24 px (`ROW_HEIGHT`); the grid's own header plus horizontal scrollbar are not known from jsdom (REPORT-008 implies between 17 and 41 px, since 65 px held exactly one complete row). So the expected grid is 2 complete rows for sure and 3 if header plus scrollbar are at most 37 px. This is an estimate; QA measures it.
- W1 at its minimum (960 x 600 css): the W1 toolbar (`shell/Toolbar.tsx`) was not changed: it is one non-wrapping row of fixed 56 px (`h-14`), so it never has more than one row, labels kept. By the same arithmetic the workspace gets 600 - 56 toolbar - 28 status - 34 traffic bar = 482 px, minus the 8 px padding and the 30 px title bar of a maximized sub-window, about 440 px for the PollView, so the grid is about 370 px (about 13 rows), well above 2. NOT checked: whether that single toolbar row fits at 960 px without clipping when connected (File, Connection, New poll, Window, the long connection pill, the summary chip, Pause all and Disconnect: my sum is about 1000 px against 932 px of content; the profile label is already hidden below 1100 px). If QA sees a clipped control in W1 at 960 px that is a separate finding (that toolbar has no wrap or shrink rule); I did not change W1 because the brief says check only.
- Tests: `native-toolbar.logic.test.ts` (threshold, vectors at 900, 700, 640, 639.9, 560, 520, 466, 465.6, 0; the snap gives the exact answer at every 0.1 px from 400 to 1000; classes per mode), `NativeToolbar.test.tsx` (at 466, 520, 560, 639.9: four buttons without text, exact `aria-label` and `title`; icons; Resume with play; 32 px pill buttons; pills keep icon and visible text; two groups without inner wrap, `min-w-20` name; DOM and focus order identical at 900 and 466; disabled Write… reason; Dock still acts; at 640, 700, 900 text, shortcut titles and 60 px; 639 -> 640 -> 639.9). The native harness `setWidth` now also reports the width to the toolbar (`data-slot="native-toolbar"`). No existing test needed a change for the labels (they find the buttons by role and name, which the `aria-label` keeps).
- What only a real window can verify: the real number of toolbar rows (offsetTop of the two groups, and that the groups really do not wrap), the real toolbar height (expected 76 px at 465.6 css px), the grid height and the number of complete grid rows at 465.6 x 282.4 css px (expected about 109 px, 2 or 3 rows), that the pills and 32 px buttons are not clipped at 466, 520, 560, 639.9 and 640, no flicker or resize loop while dragging across 640 (the toolbar height changes from 84 to 76 or from 60 to 40 there), the one-frame full-label flash before the first measurement, and that W1 at 960 px has no clipped control. QA measures with `getBoundingClientRect` at the real minimum and reports the numbers.

## Implementation notes (REPORT-008 final fixes)
2026-10-18. D11 and D12 of `docs/qa/REPORT-008-targeted-rerun.md` sections 1c and 1d. Frontend only (`apps/desktop/src`). Not verified in a real window: see the end of this section.

### D11 - the W2 toolbar flipped between label modes in a width band
- Root cause as QA read it: `useElementWidth` used `entry.contentRect.width` (content box) after an initial `getBoundingClientRect` read (border box), and the toolbar padding differed per mode (`px-4` full, `px-3` icon), so the content width depended on the mode being decided.
- Fix 1 (measurement): `useElementWidth` (`poll-view/context.tsx`) now measures the BORDER box. New pure `poll-view/border-width.ts` `entryBorderWidth(entry)`: `borderBoxSize[0].inlineSize` (also the old single-object form), else `target.getBoundingClientRect().width`, else 0 (no layout; the entry is ignored). `contentRect` is never read. The observer is started with `{ box: "border-box" }`. `TOOLBAR_ICON_ONLY_BELOW = 640` now means the border-box width of the toolbar, which is the window client width.
- Fix 2 (padding): `native-toolbar.logic.ts` has `TOOLBAR_PADDING_X = "px-3"`, used by BOTH modes. Deviation to know: the full mode lost 4 px of side padding on each side (`px-4` -> `px-3`) so that both modes have the same content box; vertical padding and gaps per mode are unchanged. The border box of a block does not depend on its own padding, so with fix 1 alone the decision is already independent of the mode; fix 2 makes it independent even for a content-box reading.
- Audit of the other consumers of `useElementWidth`:
  - `NativeToolbar` (the defect): fixed as above.
  - `PollView` Body (`snapViewWidth`, status line steps, `isWideHeader`, the presentation fallback): the root has no padding and no border (its `p-2` is on the inner row), so content box = border box and the old code was already exact; the decisions change children (dock, panel, rail, popover, header layout) but never the padding, border or intrinsic width of the root, whose width comes from the parent (`h-full min-w-0` in a column, a `flex-1` block inside the sub-window frame). The dock, panel and popover have fixed inline widths. No loop. It now reads the border box too (the same number).
  - `ScaleSection` (`Math.round`, 260 px): the measured `div` has no padding or border (`flex flex-col gap-4`); the `stacked` decision changes only its children; its width is that of the setup dock, panel or popover (fixed `width` in `style`, padding on the `aside`, not on the measured div). Same number in both boxes. No loop. Documented, not changed.
  - `useFrameWidth` (sub-window frame) already used `offsetWidth` and `box: "border-box"`. `Workspace.tsx` has its own observer on `contentRect` (the workspace inner size; it is not `useElementWidth` and has no mode-dependent padding): not touched.
- Test harness: `poll-view/test-utils.tsx` `fire(width, slot, contentWidth = width)` now sends `borderBoxSize` (the width) and `contentRect` (`contentWidth`); `native/test-utils.tsx` has `fireToolbarWidth(border, content)`.
- Tests: `poll-view/border-width.test.ts` (array form, object form, fallbacks, no layout); `native/NativeToolbarWidth.test.tsx`: a stateful sweep of the real `NativeToolbar` with simulated entries at 630-700 css px in 0.5 px steps, up and down, each width run 10 times with the content width fed back as `border - padding(current mode)` (padding read from the real classes): (a) exactly one mode change up and one down, (b) the switch is at border 640 (up: first full at 640; down: first icon at 639.5), (c) after the first update at a width the mode never changes again; plus rest at 660-676 for 60 updates stays full, a wrong content width is ignored, both modes have the same padding, and a control that models the old content-box rule (32 / 24 px) oscillates at 668 and says icon at 650 (so the settle check is known to catch the defect). The sweep tests were also run against the old `contentRect` code and fail there.

### D12 - the W1 toolbar clipped "Disconnect" at 960 css px
- New pure `shell/toolbar.logic.ts`: `NARROW_WIDTH = 1100` (moved from `Toolbar.tsx`), `SQUEEZE_WEIGHT = { profile: 100, chip: 10, pill: 1 }`, `toolbarSqueezeFor(widthCss)` returns `narrow`, `showProfile`, `shortChip` and the class strings of the row, the profile label, the chip, the pill and the action group.
- `shell/Toolbar.tsx`: still ONE row, fixed `h-14` (56 px), no wrap. Order of squeezing: (1) the profile label (hidden below 1100; at 1100 and above `min-w-0 truncate`, full name in `title`, "· Modified" is `shrink-0`; flex-shrink 100), (2) the summary chip text (wrapper `min-w-0`, flex-shrink 10, the visible text is cut with an ellipsis; its `title` and its screen-reader text keep the full text), (3) the connection pill text (`min-w-0`, flex-shrink 1, label cut at the END so the target host:port goes first; `title` = full text; the icon never shrinks), (4) the gaps and side padding: below 1100 `gap-1.5` and `px-3` (were `gap-2`, `px-3.5`); the action group gap follows. The menus (File, Connection, Window), New poll, Pause all, Connect, Cancel and Disconnect are `shrink-0` (the menu triggers got `shrink-0 whitespace-nowrap`; the buttons already had both) and the action group is `shrink-0`.
- `shared/ui/status-pill.tsx`: new optional `truncate` prop (`min-w-0` on the pill, `min-w-0 truncate` on the label span); no change without it.
- Honest limit: flex shrinks in proportion to `shrink * base width`, so the 100:10:1 weights make the order strict in practice, not mathematically: a part that has not reached its minimum can still lose a fraction of a pixel when another one gives way. The 960 px case QA measured (16 px over) is now absorbed by the smaller gaps and padding (about 16 px by arithmetic: 6 gaps x 2 px, 2 x 2 px padding) and, for the rest or for longer texts, by the pill and chip text with an ellipsis.
- Tests: `shell/toolbar.logic.test.ts` (vectors 960, 1000, 1099.9, 1100, 1300; fixed height; gaps; weight order; actions never shrink); `components/ToolbarSqueeze.test.tsx` (the real toolbar at 960, 1000, 1100, 1300 with a 35 character host and a 5 part chip: one row `h-14` without wrap, pill ellipsis and full `title`, chip ellipsis and full `title` and accessible name, menus, buttons and action group `shrink-0`, weight order profile > chip > pill > 0, gaps by width, the profile truncation).

### Also fixed on the way
- `shared/ui/icon.tsx` had `Play` imported twice and `play: Play` listed twice (a parse error in the transformer for every test that imports an icon; the file was last modified at 23:55 on 2026-10-17, not by this change): the duplicate lines were removed.

### What only a real window can verify (for QA)
- D11: rest the native window at client 664-672 css (outer 848-856 physical at 125 %) for 2 s: 0 mode changes and a stable height (84.8 px); drag slowly across the threshold (120 steps x 20 ms, narrowing and widening): exactly one transition per crossing, at client 640 css; the 640-663 band shows the labels. That WebView2 really reports `borderBoxSize` (Chromium does; the code falls back to `getBoundingClientRect`). The full-mode toolbar height and wrap point with the 12 px side padding (the point where the two groups wrap moves by 8 px).
- D12: at the W1 minimum (960 css, connected, Standard 8 polls, exception chip): toolbar `scrollWidth <= clientWidth` and the right edge of "Disconnect" inside the window with its padding; the same with a 40 character host; the real widths at 1000 and 1100 css (the profile label appears at 1100; the order profile, chip, pill is visible only with real text widths); the ellipsis and the `title` tooltips where text is cut (hover tooltips are not visible through CDP).
