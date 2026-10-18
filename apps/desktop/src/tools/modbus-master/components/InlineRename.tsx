import { useRef, useState } from "react";
import { cn } from "@/shared/lib/utils";

interface InlineRenameProps {
  name: string;
  /** Sends the rename. Returns the message to show under the field, or null when it was sent. */
  onCommit(text: string): Promise<string | null>;
  /** Rename ended (committed, reverted, or Esc). */
  onDone(): void;
  /** Classes of the input (the title bar and the sidebar row differ in size). */
  inputClassName?: string;
}

/**
 * Inline rename of a poll (DES-002 2.2.3, 2.3.1, rules of section 4): `Enter` sends it (an invalid
 * name keeps the field open with its message), `Esc` cancels, a blur sends it when it is valid and
 * reverts it otherwise.
 */
export function InlineRename({ name, onCommit, onDone, inputClassName }: InlineRenameProps) {
  const [text, setText] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(false);

  const finish = () => {
    done.current = true;
    onDone();
  };
  const commit = async () => {
    const message = await onCommit(text);
    if (message) setError(message);
    else finish();
  };

  return (
    <span className="relative min-w-0 flex-1">
      <input
        // biome-ignore lint/a11y/noAutofocus: the input appears because the user asked to rename.
        autoFocus
        aria-label="Poll name"
        aria-invalid={error ? true : undefined}
        value={text}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        // Not a drag grip, and not a click on the row.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            finish();
          }
        }}
        onBlur={() => {
          // Blur commits when valid, otherwise reverts.
          if (done.current) return;
          done.current = true;
          void onCommit(text).then(onDone);
        }}
        className={cn(
          "h-6 w-full rounded-md border border-dark bg-card px-2 text-[13px] font-semibold text-dark outline-none",
          inputClassName,
        )}
      />
      {error ? (
        <span
          role="alert"
          className="absolute left-0 top-7 z-20 max-w-60 whitespace-normal rounded-md border bg-card px-2 py-1 text-xs font-normal text-dark shadow-lg"
        >
          {error}
        </span>
      ) : null}
    </span>
  );
}
