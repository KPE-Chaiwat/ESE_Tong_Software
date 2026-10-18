import { useStore } from "zustand";
import type { AnnouncerStoreApi } from "../../store/announcer.store";
import { useRuntime } from "../context";

/**
 * The polite and the assertive live region of a window (DES-001 7, DES-002 1.5 rule 5 and 2.10.8).
 * The sequence number is the key, so a repeated text is announced again.
 */
export function LiveRegionsFor({ store }: { store: AnnouncerStoreApi }) {
  const polite = useStore(store, (s) => s.polite);
  const assertive = useStore(store, (s) => s.assertive);
  return (
    <>
      <div
        className="sr-only"
        aria-live="polite"
        role="status"
        data-testid="live-polite"
        data-seq={polite.seq}
      >
        <span key={polite.seq}>{polite.text}</span>
      </div>
      <div
        className="sr-only"
        aria-live="assertive"
        role="alert"
        data-testid="live-assertive"
        data-seq={assertive.seq}
      >
        <span key={assertive.seq}>{assertive.text}</span>
      </div>
    </>
  );
}

/** The live regions of the connection window. */
export function LiveRegions() {
  return <LiveRegionsFor store={useRuntime().stores.announcer} />;
}
