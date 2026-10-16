import { type BannerAction, StateBanner } from "@/shared/ui/state-banner";
import { type BannerActionId, bannerFor } from "../../store/session.logic";
import { useConfig, useController, useRunningSetup, useSession } from "../context";

/** The one fixed place under the toolbar for transient and abnormal session states. */
export function SessionBanner() {
  const controller = useController();
  const state = useSession((s) => s.state);
  const reason = useSession((s) => s.reason);
  const exceptionCode = useSession((s) => s.exceptionCode);
  const badResponse = useSession((s) => s.badResponse);
  const consecutiveFailures = useSession((s) => s.consecutiveFailures);
  const pending = useSession((s) => s.pending);
  const { connection, poll } = useRunningSetup();
  const addressBase = useConfig((s) => s.display.addressBase);

  const banner = bannerFor(
    { state, reason, exceptionCode, badResponse, consecutiveFailures },
    { connection, poll, addressBase },
  );
  if (!banner) return null;

  const handlers: Record<BannerActionId, BannerAction> = {
    cancel: {
      id: "cancel",
      label: "Cancel",
      pending: pending === "cancel",
      onClick: () => void controller.cancelConnect(),
    },
    reconnect: {
      id: "reconnect",
      label: "Reconnect",
      primary: true,
      pending: pending === "connect",
      disabled: pending !== null,
      onClick: () => void controller.connect(),
    },
    // Dismiss waits for the backend's idle event, so it shows its spinner until then (DES-001 T15).
    dismiss: {
      id: "dismiss",
      label: "Dismiss",
      pending: pending === "dismiss",
      onClick: () => void controller.dismiss(),
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
