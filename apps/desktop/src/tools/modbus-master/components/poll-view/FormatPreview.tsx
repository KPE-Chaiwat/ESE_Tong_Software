import type { AddressBase } from "@/shared/ipc/modbus-master.types";
import { Icon } from "@/shared/ui/icon";
import type { PreviewNotice, PreviewResult } from "../../lib/format-dialog-model";

/** A focused region scrolls into view inside the dialog body (jsdom has no `scrollIntoView`). */
const scrollIntoView = (e: { currentTarget: HTMLElement }) =>
  e.currentTarget.scrollIntoView?.({ block: "nearest" });

interface FormatPreviewProps {
  /** Prefix for the element ids. */
  idPrefix: string;
  base: AddressBase;
  preview: PreviewResult;
  /** Why there are no live values, or null. */
  notice: PreviewNotice | null;
}

/**
 * The Preview section of the Format dialog (DES-010 7): what the selection would show after Apply,
 * from the latest snapshot. Nothing here is requested from the device and nothing is announced.
 */
export function FormatPreview({ idPrefix, base, preview, notice }: FormatPreviewProps) {
  const legendId = `${idPrefix}-preview-legend`;
  return (
    <section
      aria-labelledby={legendId}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the region is focusable so a keyboard user can scroll the long preview and reach it in the Tab order (DES-010 12).
      tabIndex={0}
      data-testid="format-preview"
      onFocus={scrollIntoView}
      className="flex min-w-0 flex-col gap-1 rounded-md outline-none focus-ring"
    >
      <p id={legendId} className="mb-0.5 text-xs font-semibold uppercase tracking-wide">
        Preview
      </p>
      <p data-testid="format-preview-summary" className="text-[13px]">
        {preview.summary}
      </p>
      {notice ? (
        <p
          data-testid="format-preview-notice"
          data-kind={notice.kind}
          className="flex items-start gap-1.5 text-xs text-text-muted"
        >
          <Icon name={notice.icon} className="mt-px size-3.5 animate-none" />
          <span>{notice.text}</span>
        </p>
      ) : null}
      <table data-testid="format-preview-table" className="w-full border-collapse">
        <thead>
          <tr className="text-left text-xs font-normal text-text-muted">
            <th scope="col" className="min-w-[72px] whitespace-nowrap pr-3 font-normal">
              Address ({base}-based)
            </th>
            <th scope="col" className="w-full font-normal">
              Value
            </th>
          </tr>
        </thead>
        <tbody className="border-t border-border">
          {preview.lines.map((line) => (
            <tr
              key={line.address}
              data-testid="format-preview-row"
              data-address={line.address}
              className="h-5 font-mono text-[13px] text-foreground"
            >
              <td className="whitespace-nowrap pr-3 text-left">{line.text}</td>
              <td className="w-full max-w-0 truncate text-left" title={line.value}>
                {line.value}
              </td>
            </tr>
          ))}
          {preview.moreText ? (
            <tr data-testid="format-preview-more" className="h-5 text-[13px] text-text-muted">
              <td colSpan={2}>{preview.moreText}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </section>
  );
}
