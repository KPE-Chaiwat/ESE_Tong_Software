import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/shared/lib/utils";
import { Icon } from "./icon";

// A small accessible menu: a button that opens a `role=menu` list (and the same list at a point,
// for context menus). Arrow keys move, Home and End jump, Enter and Space choose, Esc closes and
// gives the focus back, Tab closes. The list is drawn in a portal with fixed positioning, so it is
// never clipped by a sub-window.

interface EntryBase {
  id: string;
}
export interface MenuItemEntry extends EntryBase {
  kind: "item";
  label: string;
  shortcut?: string;
  disabled?: boolean;
  /** Tooltip, for example why the entry is disabled. */
  title?: string;
  onSelect: () => void;
}
export interface MenuCheckEntry extends EntryBase {
  kind: "check";
  label: string;
  checked: boolean;
  shortcut?: string;
  disabled?: boolean;
  title?: string;
  onSelect: () => void;
}
export interface MenuRadioEntry extends EntryBase {
  kind: "radio";
  label: string;
  checked: boolean;
  shortcut?: string;
  disabled?: boolean;
  title?: string;
  onSelect: () => void;
}
/** An entry that opens a second list beside the first (Right or Enter, or a click). */
export interface MenuSubmenuEntry extends EntryBase {
  kind: "submenu";
  label: string;
  entries: readonly MenuEntry[];
  disabled?: boolean;
  /** Tooltip, for example why the submenu is disabled. */
  title?: string;
  /** Runs when the submenu opens (to refresh what it lists). */
  onOpen?: () => void;
}
export interface MenuSeparatorEntry extends EntryBase {
  kind: "separator";
}
export interface MenuHeadingEntry extends EntryBase {
  kind: "heading";
  label: string;
}
export type MenuEntry =
  | MenuItemEntry
  | MenuCheckEntry
  | MenuRadioEntry
  | MenuSubmenuEntry
  | MenuSeparatorEntry
  | MenuHeadingEntry;

interface MenuListProps {
  entries: readonly MenuEntry[];
  label: string;
  /** Fixed position of the top-left corner (or the top-right with `alignEnd`). */
  at: { x: number; y: number };
  alignEnd?: boolean;
  onClose: (restoreFocus: boolean) => void;
  /** Elements that count as "inside" for the outside-click check (the trigger). */
  insideRefs?: ReadonlyArray<React.RefObject<HTMLElement | null>>;
  /** The `id` the trigger's `aria-controls` points to. */
  id?: string;
  /** A submenu: Left and Esc go back to the list it opened from instead of closing everything. */
  onBack?: () => void;
}

const NO_REFS: ReadonlyArray<React.RefObject<HTMLElement | null>> = [];

function MenuList({
  entries,
  label,
  at,
  alignEnd,
  onClose,
  insideRefs = NO_REFS,
  id,
  onBack,
}: MenuListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [sub, setSub] = useState<{ id: string; at: { x: number; y: number } } | null>(null);

  // Disabled entries stay in the arrow-key order (WAI-ARIA menus allow it), so a keyboard user can
  // reach them and read why they are off (their title); choosing one does nothing.
  const items = () =>
    Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);

  // Keep the list inside the window, then focus the first entry (once, when the menu opens).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `items` only reads the list element.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const overflowX = Math.max(0, rect.right - (window.innerWidth - 4));
    const overflowY = Math.max(0, rect.bottom - (window.innerHeight - 4));
    if (overflowX > 0 || overflowY > 0) setOffset({ x: -overflowX, y: -overflowY });
    const all = items();
    (all.find((el) => el.getAttribute("aria-disabled") !== "true") ?? all[0])?.focus();
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (listRef.current?.contains(target)) return;
      if (insideRefs.some((r) => r.current?.contains(target))) return;
      // A press inside another list of the same menu (a submenu is a second list) is not outside.
      if (target instanceof Element && target.closest('[data-slot="menu"]')) return;
      onClose(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [onClose, insideRefs]);

  const triggerOf = (entryId: string) =>
    listRef.current?.querySelector<HTMLElement>(`[data-menu-id="${entryId}"]`) ?? null;

  const openSubmenu = (entry: MenuSubmenuEntry, trigger: HTMLElement) => {
    const rect = trigger.getBoundingClientRect();
    entry.onOpen?.();
    setSub({ id: entry.id, at: { x: rect.right - 4, y: rect.top - 4 } });
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    // A submenu is rendered inside this list's React tree: its keys must not reach this handler.
    if (onBack) event.stopPropagation();
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      event.preventDefault();
      list[(i + list.length) % list.length]?.focus();
    };
    switch (event.key) {
      case "ArrowRight": {
        const focused = list[index];
        const entry = entries.find((e) => e.kind === "submenu" && e.id === focused?.dataset.menuId);
        if (focused && entry?.kind === "submenu") {
          event.preventDefault();
          openSubmenu(entry, focused);
        }
        break;
      }
      case "ArrowLeft":
        if (onBack) {
          event.preventDefault();
          onBack();
        }
        break;
      case "ArrowDown":
        go(index + 1);
        break;
      case "ArrowUp":
        go(index === -1 ? list.length - 1 : index - 1);
        break;
      case "Home":
        go(0);
        break;
      case "End":
        go(list.length - 1);
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        if (onBack) onBack();
        else onClose(true);
        break;
      case "Tab":
        onClose(true);
        break;
      default:
    }
  };

  const backTo = () => {
    const entryId = sub?.id;
    setSub(null);
    if (entryId) triggerOf(entryId)?.focus();
  };

  const style: React.CSSProperties = {
    position: "fixed",
    top: at.y + offset.y,
    ...(alignEnd ? { right: window.innerWidth - at.x - offset.x } : { left: at.x + offset.x }),
  };

  return createPortal(
    <div
      ref={listRef}
      id={id}
      role="menu"
      aria-label={label}
      data-slot="menu"
      style={style}
      onKeyDown={onKeyDown}
      className="z-50 min-w-48 rounded-lg border bg-card p-1 text-sm text-foreground shadow-lg"
    >
      {entries.map((entry) => {
        if (entry.kind === "separator") {
          // biome-ignore lint/a11y/useSemanticElements: a menu separator is not focusable, so it cannot be an <hr> in a menu.
          return <div key={entry.id} role="separator" className="my-1 h-px bg-border" />;
        }
        if (entry.kind === "submenu") {
          const open = sub?.id === entry.id;
          return (
            <button
              key={entry.id}
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={open}
              aria-disabled={entry.disabled || undefined}
              title={entry.title}
              tabIndex={-1}
              data-menu-id={entry.id}
              onClick={(e) => {
                if (entry.disabled) return;
                if (open) setSub(null);
                else openSubmenu(entry, e.currentTarget);
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left outline-none focus-visible:bg-neutral-tint hover:bg-neutral-tint",
                entry.disabled && "text-text-muted",
              )}
            >
              <span className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{entry.label}</span>
              <Icon name="chevron-right" className="size-3.5" />
            </button>
          );
        }
        if (entry.kind === "heading") {
          return (
            <div
              key={entry.id}
              role="presentation"
              className="px-3 py-1 text-xs font-semibold text-text-muted"
            >
              {entry.label}
            </div>
          );
        }
        const role =
          entry.kind === "check"
            ? "menuitemcheckbox"
            : entry.kind === "radio"
              ? "menuitemradio"
              : "menuitem";
        const checked = entry.kind === "item" ? undefined : entry.checked;
        return (
          // biome-ignore lint/a11y/useAriaPropsSupportedByRole: `role` is a variable (menuitemcheckbox or menuitemradio) when `checked` is set.
          <button
            key={entry.id}
            type="button"
            role={role}
            aria-checked={checked}
            aria-disabled={entry.disabled || undefined}
            title={entry.title}
            tabIndex={-1}
            data-menu-id={entry.id}
            onClick={() => {
              if (entry.disabled) return;
              onClose(true);
              entry.onSelect();
            }}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left outline-none focus-visible:bg-neutral-tint hover:bg-neutral-tint",
              entry.disabled && "text-text-muted",
            )}
          >
            <span className="flex size-4 shrink-0 items-center justify-center">
              {checked ? <Icon name="check" className="size-3.5" /> : null}
            </span>
            <span className="min-w-0 flex-1 truncate">{entry.label}</span>
            {entry.shortcut ? (
              <span className="ml-4 shrink-0 text-xs text-text-muted">{entry.shortcut}</span>
            ) : null}
          </button>
        );
      })}
      {sub ? <SubmenuList entries={entries} sub={sub} onClose={onClose} onBack={backTo} /> : null}
    </div>,
    document.body,
  );
}

/** The second list of a submenu entry, beside the entry. */
function SubmenuList({
  entries,
  sub,
  onClose,
  onBack,
}: {
  entries: readonly MenuEntry[];
  sub: { id: string; at: { x: number; y: number } };
  onClose: (restoreFocus: boolean) => void;
  onBack: () => void;
}) {
  const entry = entries.find((e) => e.kind === "submenu" && e.id === sub.id);
  if (entry?.kind !== "submenu") return null;
  return (
    <MenuList
      entries={entry.entries}
      label={entry.label}
      at={sub.at}
      onClose={onClose}
      onBack={onBack}
    />
  );
}

interface MenuButtonProps {
  /** Accessible name of the menu (and of the button when it has no text). */
  label: string;
  entries: readonly MenuEntry[];
  children: ReactNode;
  className?: string;
  /** Opens the menu with its right edge under the button's right edge. */
  alignEnd?: boolean;
  disabled?: boolean;
  title?: string;
  /** Takes the button out of the tab order (a mouse shortcut to a menu that has a keyboard route). */
  skipTab?: boolean;
}

/** A button that opens a menu under itself. */
export function MenuButton({
  label,
  entries,
  children,
  className,
  alignEnd,
  disabled,
  title,
  skipTab,
}: MenuButtonProps) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  // A stable array, so the open menu does not re-subscribe its outside-click listener on a render.
  const insideRefs = useMemo(() => [buttonRef], []);
  const close = useCallback((restoreFocus: boolean) => {
    setAt(null);
    if (restoreFocus) buttonRef.current?.focus();
  }, []);

  const open = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setAt({ x: alignEnd ? rect.right : rect.left, y: rect.bottom + 4 });
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={at !== null}
        aria-controls={at ? menuId : undefined}
        disabled={disabled}
        title={title}
        {...(skipTab ? { tabIndex: -1 } : {})}
        onClick={() => (at ? close(true) : open())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && at === null) {
            e.preventDefault();
            open();
          }
        }}
        className={className}
      >
        {children}
      </button>
      {at ? (
        <MenuList
          entries={entries}
          label={label}
          at={at}
          alignEnd={alignEnd ?? false}
          onClose={close}
          insideRefs={insideRefs}
          id={menuId}
        />
      ) : null}
    </>
  );
}

interface ContextMenuProps {
  /** Where to open it (client coordinates); null = closed. */
  position: { x: number; y: number } | null;
  entries: readonly MenuEntry[];
  label: string;
  /** `restoreFocus` is true when the menu closed by keyboard or by choosing an entry. */
  onClose: (restoreFocus: boolean) => void;
}

/** The same menu, opened at a point (right click, Shift+F10). */
export function ContextMenu({ position, entries, label, onClose }: ContextMenuProps) {
  if (!position) return null;
  return <MenuList entries={entries} label={label} at={position} onClose={onClose} />;
}
