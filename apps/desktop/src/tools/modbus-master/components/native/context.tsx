import { createContext, type ReactNode, useContext } from "react";
import { useStore } from "zustand";
import type { NativePollRuntime } from "../../runtime/native-poll-runtime";
import type { ArrangeStore } from "../../store/arrange.store";
import type { ConnectionStore } from "../../store/connection.store";
import type { PollStore } from "../../store/poll.store";
import type { PollHostStore } from "../../store/poll-host.store";
import type { PrefsStore } from "../../store/prefs.store";

const RuntimeContext = createContext<NativePollRuntime | null>(null);

export function NativeRuntimeProvider({
  runtime,
  children,
}: {
  runtime: NativePollRuntime;
  children: ReactNode;
}) {
  return <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>;
}

export function useNativeRuntime(): NativePollRuntime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error("NativeRuntimeProvider is missing");
  return runtime;
}

// Typed store hooks of a native window. Components select the minimum slice.
export const useNativePoll = <T,>(sel: (s: PollStore) => T) =>
  useStore(useNativeRuntime().view.stores.poll, sel);
export const useNativeConnection = <T,>(sel: (s: ConnectionStore) => T) =>
  useStore(useNativeRuntime().stores.connection, sel);
export const useNativeHost = <T,>(sel: (s: PollHostStore) => T) =>
  useStore(useNativeRuntime().stores.host, sel);
export const useNativePrefs = <T,>(sel: (s: PrefsStore) => T) =>
  useStore(useNativeRuntime().stores.prefs, sel);
export const useNativeArrange = <T,>(sel: (s: ArrangeStore) => T) =>
  useStore(useNativeRuntime().stores.arrange, sel);
