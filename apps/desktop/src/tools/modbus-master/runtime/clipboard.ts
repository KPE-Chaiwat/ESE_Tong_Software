/** The clipboard as the poll view uses it. Tests pass a recording one. */
export interface PollClipboard {
  writeText(text: string): Promise<void>;
  /** Not every webview allows reading; without it, "Paste aliases" from the menu is unavailable. */
  readText?(): Promise<string>;
}

/** The browser clipboard (WebView2 allows it from a user gesture). */
export const browserClipboard: PollClipboard = {
  writeText: (text) => navigator.clipboard.writeText(text),
  readText: () => navigator.clipboard.readText(),
};

/**
 * Pop out and dock blur the inline editor that has the focus first: a valid alias or name is
 * committed, an invalid one is reverted (DES-002 2.5.4).
 */
export function blurActiveEditor(): void {
  const el = globalThis.document?.activeElement;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.blur();
}
