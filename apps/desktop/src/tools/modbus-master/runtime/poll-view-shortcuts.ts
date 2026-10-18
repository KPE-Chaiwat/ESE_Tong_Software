// The shortcuts that belong to one poll view (DES-002 3.1, "scope SW" and the W2 column): the
// format keys, the address base, the Show cycle and Write. Both hosts bind them to the view that
// has the keyboard scope: W1 to the focused or active sub-window, a native window to its own view.
import type { ValueFormat } from "@/shared/ipc/modbus-master.types";
import { isBitFunction } from "../lib/functions";
import type { Binding } from "../lib/shortcuts";
import { nextValueColumns } from "../store/poll-scale.logic";
import type { PollViewRuntime } from "./poll-view-runtime";

const FORMAT_KEYS: ReadonlyArray<readonly [string, ValueFormat]> = [
  ["ctrl+1", "unsigned"],
  ["ctrl+2", "signed"],
  ["ctrl+3", "hex"],
  ["ctrl+4", "binary"],
];

/** The next value of Show on `Ctrl+Shift+V` (DES-003 3.3) lives with the other scale rules. */
export { nextValueColumns };

/**
 * Bindings for the view `getView()` returns. Each one does nothing (and lets the key through,
 * unless a browser uses it) when there is no view in scope or the focus is in a text field.
 */
export function pollViewBindings(
  getView: () => PollViewRuntime | undefined,
  isTextField: () => boolean,
): Binding[] {
  const config = (view: PollViewRuntime) => view.stores.poll.getState().config;
  const registers = (view: PollViewRuntime) => {
    const c = config(view);
    return c !== null && !isBitFunction(c.definition.function);
  };
  const bindings: Binding[] = FORMAT_KEYS.map(([combo, format]) => ({
    combo,
    when: () => {
      const view = getView();
      return view !== undefined && registers(view);
    },
    run: () => void getView()?.actions.setFormat(format),
  }));
  bindings.push(
    {
      combo: "ctrl+b",
      when: () => getView() !== undefined,
      run: () => {
        const view = getView();
        const c = view ? config(view) : null;
        if (view && c) void view.actions.setAddressBase(c.display.addressBase === 0 ? 1 : 0);
      },
    },
    {
      combo: "ctrl+shift+v",
      when: () => getView() !== undefined && !isTextField(),
      run: () => {
        const view = getView();
        const c = view ? config(view) : null;
        if (view && c) {
          void view.actions.cycleValueColumns();
        }
      },
    },
    {
      // "Set scale for selected rows..." (DES-003 3.2): opens S8 for the selected rows.
      combo: "ctrl+shift+e",
      when: () => getView() !== undefined && !isTextField(),
      run: () => {
        getView()?.actions.openOverrideForSelection();
      },
    },
    {
      combo: "ctrl+e",
      when: () => getView()?.hostActions.write !== undefined,
      run: () => getView()?.hostActions.write?.(null),
    },
  );
  return bindings;
}
