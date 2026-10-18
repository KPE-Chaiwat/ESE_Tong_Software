/** Actual full-sidebar visibility, including the transient compact-mode peek (DES-007). */
export function sidebarExpanded(compact: boolean, peek: boolean, collapsed: boolean): boolean {
  return compact ? peek : !collapsed;
}

export const SIDEBAR_ID = "connection-sidebar";
export const SIDEBAR_TOGGLE_ID = "connection-sidebar-toggle";
