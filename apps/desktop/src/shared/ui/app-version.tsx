import { useEffect, useState } from "react";
import type { AppInfo } from "@/shared/bindings";
import { cn } from "@/shared/lib/utils";

/**
 * Loads the app version once. Resolves to `null` while loading and when `app_info` is not
 * available (plain browser, failed call): the label is only a courtesy and must never break a page.
 */
export function useAppVersion(load: () => Promise<AppInfo>): string | null {
  const [version, setVersion] = useState<string | null>(null);

  // `load` is read once on mount: callers pass a stable function (the IPC facade).
  // biome-ignore lint/correctness/useExhaustiveDependencies: load once per mount
  useEffect(() => {
    let live = true;
    // `Promise.resolve().then` also turns a synchronous throw into a rejection.
    Promise.resolve()
      .then(load)
      .then((info) => {
        if (live) setVersion(info.version);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  return version;
}

interface AppVersionProps {
  load: () => Promise<AppInfo>;
  className?: string;
}

/** Small muted "ESEfact v0.1.0" text. Renders nothing until the version is known. */
export function AppVersion({ load, className }: AppVersionProps) {
  const version = useAppVersion(load);
  if (version === null) return null;
  return (
    <span data-testid="app-version" className={cn("shrink-0 whitespace-nowrap text-xs", className)}>
      ESEfact v{version}
    </span>
  );
}
