import { type BannerAction, StateBanner } from "@/shared/ui/state-banner";
import { type ConnectionBannerActionId, connectionBannerFor } from "../../store/connection.logic";
import { useActions, useConnection } from "../context";

/**
 * The one fixed place under the toolbar for the connection states connecting and disconnected
 * (DES-002 1.5 rule 4). Poll failures never use it: they show in the poll row and the status line.
 */
export function ConnectionBanner() {
  const actions = useActions();
  const state = useConnection((s) => s.state);
  const reason = useConnection((s) => s.reason);
  const config = useConnection((s) => s.connection);
  const pending = useConnection((s) => s.pending);
  if (!config) return null;
  const banner = connectionBannerFor(state, reason, config);
  if (!banner) return null;

  const handlers: Record<ConnectionBannerActionId, BannerAction> = {
    cancel: {
      id: "cancel",
      label: "Cancel",
      pending: pending === "cancel",
      onClick: () => void actions.cancelConnect(),
    },
    reconnect: {
      id: "reconnect",
      label: "Reconnect",
      primary: true,
      pending: pending === "connect",
      disabled: pending !== null,
      onClick: () => void actions.connect(),
    },
    // Dismiss waits for the backend's idle event, so it shows its spinner until then (DES-001 T15).
    dismiss: {
      id: "dismiss",
      label: "Dismiss",
      pending: pending === "dismiss",
      onClick: () => void actions.dismiss(),
    },
  };

  return (
    <StateBanner
      variant={banner.variant}
      icon={banner.icon}
      actions={banner.actions.map((id) => handlers[id])}
    >
      {banner.text}
    </StateBanner>
  );
}
