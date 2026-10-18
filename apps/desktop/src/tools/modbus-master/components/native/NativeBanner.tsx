import { type BannerAction, StateBanner } from "@/shared/ui/state-banner";
import { type NativeBannerAction, nativeBannerFor } from "../../store/native-poll.logic";
import { useNativeConnection, useNativePoll, useNativeRuntime } from "./context";

/**
 * The one banner of a native poll window (DES-002 2.6): the connection banner while the link is not
 * up, else the banner of a failing poll. Never both. There is no Disconnect or Cancel here.
 */
export function NativeBanner() {
  const { actions } = useNativeRuntime();
  const connection = useNativeConnection((s) => s.state);
  const reason = useNativeConnection((s) => s.reason);
  const config = useNativeConnection((s) => s.connection);
  const pending = useNativeConnection((s) => s.pending);
  const state = useNativePoll((s) => s.state);
  const exceptionCode = useNativePoll((s) => s.exceptionCode);
  const badResponse = useNativePoll((s) => s.badResponse);
  const failures = useNativePoll((s) => s.consecutiveFailures);
  const pollConfig = useNativePoll((s) => s.config);

  const banner = nativeBannerFor({
    connection,
    reason,
    config,
    poll: { state, exceptionCode, badResponse, consecutiveFailures: failures },
    pollConfig: pollConfig
      ? {
          definition: pollConfig.definition,
          timeoutMs: config?.timeoutMs ?? 1000,
          addressBase: pollConfig.display.addressBase,
        }
      : null,
  });
  if (!banner) return null;

  const handlers: Record<NativeBannerAction, BannerAction> = {
    reconnect: {
      id: "reconnect",
      label: "Reconnect",
      primary: true,
      pending: pending === "connect",
      disabled: pending !== null,
      onClick: () => void actions.connectOrReconnect(),
    },
    connectionWindow: {
      id: "connection-window",
      label: "Connection window",
      onClick: () => void actions.focusConnectionWindow(),
    },
  };

  return (
    <div data-region="banner">
      <StateBanner
        variant={banner.variant}
        icon={banner.icon}
        actions={banner.actions.map((id) => handlers[id])}
      >
        {banner.text}
      </StateBanner>
    </div>
  );
}
