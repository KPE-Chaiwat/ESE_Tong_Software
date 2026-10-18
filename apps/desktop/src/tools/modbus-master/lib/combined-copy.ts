import { toDisplayAddress } from "./address";
import { type CombinedRow, combinedText } from "./combined";

export interface CombinedCopyOptions {
  base: 0 | 1;
  includeAlias: boolean;
  header: boolean;
  label: string;
  rawRegisters?: boolean;
}
export function combinedCopyText(
  rows: readonly CombinedRow[],
  aliases: ReadonlyMap<number, string>,
  options: CombinedCopyOptions,
): string {
  const lines: string[] = [];
  const line = (address: number, text: string) =>
    [
      ...(options.includeAlias ? [aliases.get(address) ?? ""] : []),
      String(toDisplayAddress(address, options.base)),
      text,
    ].join("\t");
  if (options.header)
    lines.push(
      [
        ...(options.includeAlias ? ["Alias"] : []),
        `Address (${options.base}-based)`,
        options.rawRegisters ? "Raw (Unsigned)" : `Interpreted (${options.label})`,
      ].join("\t"),
    );
  for (const row of rows) {
    if (options.rawRegisters)
      row.words.forEach((word, index) => {
        lines.push(line(row.address + index, String(word)));
      });
    else lines.push(line(row.address, combinedText(row.value, "")));
  }
  return lines.join("\n");
}
