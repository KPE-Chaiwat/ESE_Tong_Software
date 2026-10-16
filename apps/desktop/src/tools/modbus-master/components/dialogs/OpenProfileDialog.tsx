import { useEffect, useId, useState } from "react";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Dialog } from "@/shared/ui/dialog";
import { FieldMessage } from "@/shared/ui/field-message";
import { Icon } from "@/shared/ui/icon";
import { Input } from "@/shared/ui/input";
import { formatDateTime } from "../../lib/format";
import { visibleProfiles } from "../../store/profiles.store";
import { useController, useDialogs, useModalLock, useProfiles, useRuntime } from "../context";

/** S3 Open profile (DES-001): filter, list, Open, inline Rename and Delete with a confirm. */
export function OpenProfileDialog() {
  const uid = useId();
  const runtime = useRuntime();
  const controller = useController();
  const { profiles, dialogs, confirm, config } = runtime.stores;
  const open = useDialogs((s) => s.openProfileVisible);
  const status = useProfiles((s) => s.status);
  const items = useProfiles((s) => s.items);
  const error = useProfiles((s) => s.error);
  const filter = useProfiles((s) => s.filter);
  useModalLock(open);

  const [selected, setSelected] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);

  // The list is read again every time the dialog opens, so profiles saved in other windows appear.
  useEffect(() => {
    if (open) {
      setSelected(null);
      setRenaming(null);
      setRenameError(null);
      profiles.getState().setFilter("");
      void profiles.getState().refresh();
    }
  }, [open, profiles]);

  const visible = visibleProfiles(items, filter);
  const loading = status === "loading";

  const close = () => dialogs.getState().hideOpenProfile();

  // A profile file that cannot be read (newer schema, corrupt) can be renamed or deleted, not opened.
  const selectedReadable = items.find((p) => p.name === selected)?.readable ?? false;

  const openSelected = async (name: string | null = selected) => {
    if (!name) return;
    if (!items.find((p) => p.name === name)?.readable) return;
    close();
    await controller.loadProfile(name);
  };

  const startRename = () => {
    if (!selected) return;
    setRenaming(selected);
    setRenameText(selected);
    setRenameError(null);
  };

  const commitRename = async () => {
    if (!renaming) return;
    const result = await profiles.getState().rename(renaming, renameText);
    if (!result.ok) {
      setRenameError(result.message);
      return;
    }
    // The title follows when the renamed profile is the one loaded in this window.
    // The backend matches names ignoring case, so the loaded profile is compared that way too.
    if (config.getState().profileName?.toLowerCase() === renaming.toLowerCase()) {
      config.getState().setProfileName(renameText);
    }
    setSelected(renameText);
    setRenaming(null);
    setRenameError(null);
  };

  const remove = async () => {
    if (!selected) return;
    const name = selected;
    const answer = await confirm.getState().ask({
      title: "Delete profile?",
      body: `Delete "${name}"? This cannot be undone.`,
      buttons: [
        { id: "cancel", label: "Cancel", variant: "outline" },
        { id: "delete", label: "Delete", variant: "destructive" },
      ],
      defaultId: "cancel",
      cancelId: "cancel",
    });
    if (answer !== "delete") return;
    const result = await profiles.getState().remove(name);
    if (result.ok) setSelected(null);
    else setRenameError(result.message);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title="Open profile"
      widthClass="w-[560px]"
      initialFocus="[data-autofocus]"
      onEscapeKeyDown={(e) => {
        // Esc first cancels an inline rename; the dialog stays open.
        if (renaming !== null) {
          e.preventDefault();
          setRenaming(null);
          setRenameError(null);
        }
      }}
    >
      <div className="flex flex-col gap-3">
        <Input
          data-autofocus=""
          aria-label="Filter profiles"
          placeholder="Filter profiles…"
          value={filter}
          onChange={(e) => profiles.getState().setFilter(e.target.value)}
        />

        <div className="min-h-40 rounded-md border" data-testid="profile-list">
          {loading ? (
            <p className="flex items-center justify-center gap-2 p-6 text-sm text-text-muted">
              <Icon name="loader" />
              Loading profiles…
            </p>
          ) : status === "error" ? (
            <div className="flex flex-col items-center gap-2 p-6 text-sm">
              <p className="flex items-center gap-2">
                <Icon name="circle-x" tone="error" />
                Could not load profiles: {error}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void profiles.getState().refresh()}
              >
                Retry
              </Button>
            </div>
          ) : items.length === 0 ? (
            <p className="p-6 text-center text-sm text-text-muted">
              No saved profiles yet. Use Save as (Ctrl+Shift+S) to create one.
            </p>
          ) : visible.length === 0 ? (
            <p className="p-6 text-center text-sm text-text-muted">
              No profiles match "{filter.trim()}".
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs">
                  <th className="px-2 py-1 font-semibold">Name</th>
                  <th className="px-2 py-1 font-semibold">Connection</th>
                  <th className="px-2 py-1 font-semibold">Modified</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => {
                  const isSelected = selected === p.name;
                  const isRenaming = renaming === p.name;
                  return (
                    <tr
                      key={p.name}
                      aria-selected={isSelected}
                      tabIndex={0}
                      className={cn(
                        "cursor-default border-l-[3px] outline-none focus-ring",
                        isSelected
                          ? "border-dark bg-selected"
                          : "border-transparent hover:bg-neutral-tint",
                      )}
                      onClick={() => setSelected(p.name)}
                      onDoubleClick={() => void openSelected(p.name)}
                      onKeyDown={(e) => {
                        if (e.target !== e.currentTarget) return;
                        if (e.key === "Enter") void openSelected(p.name);
                        if (e.key === " ") {
                          e.preventDefault();
                          setSelected(p.name);
                        }
                      }}
                    >
                      <td className="px-2 py-1">
                        {isRenaming ? (
                          <div>
                            <Input
                              autoFocus
                              aria-label="New profile name"
                              value={renameText}
                              aria-invalid={renameError ? true : undefined}
                              aria-describedby={renameError ? `${uid}-rename-error` : undefined}
                              onChange={(e) => {
                                setRenameText(e.target.value);
                                setRenameError(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  void commitRename();
                                } else if (e.key === "Escape") {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setRenaming(null);
                                  setRenameError(null);
                                }
                              }}
                            />
                            {renameError ? (
                              <FieldMessage
                                kind="error"
                                id={`${uid}-rename-error`}
                                className="mt-1"
                              >
                                {renameError}
                              </FieldMessage>
                            ) : null}
                          </div>
                        ) : (
                          p.name
                        )}
                      </td>
                      <td className="px-2 py-1 font-mono text-[13px]">
                        {p.readable ? (
                          p.connectionSummary
                        ) : (
                          <span
                            className="flex items-center gap-1 font-sans"
                            title={p.connectionSummary}
                          >
                            <Icon name="triangle-alert" />
                            Cannot be opened (newer or damaged file)
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1 font-mono text-[13px]">
                        {formatDateTime(p.modifiedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {renameError && renaming === null ? (
          <FieldMessage kind="error" id={`${uid}-error`}>
            {renameError}
          </FieldMessage>
        ) : null}

        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!selected || loading}
              onClick={startRename}
            >
              Rename
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={!selected || loading}
              onClick={() => void remove()}
            >
              Delete
            </Button>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!selected || !selectedReadable || loading}
              onClick={() => void openSelected()}
            >
              Open
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
