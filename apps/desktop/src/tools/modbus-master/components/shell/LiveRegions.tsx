import { useEffect, useRef, useState } from "react";
import { bannerFor, pillFor } from "../../store/session.logic";
import { useConfig, useRunningSetup, useSession } from "../context";

/**
 * Screen reader announcements for session state changes (DES-001 7): the pill label and banner
 * text, once per transition into a new state. `disconnected` is assertive, the rest polite.
 * Repeats of the same state (the "n in a row" counter) are not announced again.
 */
export function LiveRegions() {
  const state = useSession((s) => s.state);
  const reason = useSession((s) => s.reason);
  const exceptionCode = useSession((s) => s.exceptionCode);
  const badResponse = useSession((s) => s.badResponse);
  const consecutiveFailures = useSession((s) => s.consecutiveFailures);
  const { connection, poll } = useRunningSetup();
  const addressBase = useConfig((s) => s.display.addressBase);

  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");
  const previous = useRef(state);

  // Only a change of state is announced; the other values are read at that moment.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above.
  useEffect(() => {
    if (previous.current === state) return;
    previous.current = state;
    const pill = pillFor(state, exceptionCode);
    const banner = bannerFor(
      { state, reason, exceptionCode, badResponse, consecutiveFailures },
      { connection, poll, addressBase },
    );
    const text = banner ? `${pill.label}. ${banner.text}` : pill.label;
    if (state === "disconnected") {
      setAssertive(text);
      setPolite("");
    } else {
      setPolite(text);
      setAssertive("");
    }
  }, [state]);

  return (
    <>
      <div className="sr-only" aria-live="polite" role="status" data-testid="live-polite">
        {polite}
      </div>
      <div className="sr-only" aria-live="assertive" role="alert" data-testid="live-assertive">
        {assertive}
      </div>
    </>
  );
}
