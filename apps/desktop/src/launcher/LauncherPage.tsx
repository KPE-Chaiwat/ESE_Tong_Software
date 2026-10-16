import { ArrowRight } from "lucide-react";
import { useState } from "react";
import type { AppInfo } from "@/shared/bindings";
import { getAppInfo } from "@/shared/ipc";
import type { ToolManifest } from "@/shared/lib/tool-manifest";
import { AppVersion } from "@/shared/ui/app-version";
import { Button } from "@/shared/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/shared/ui/card";
import { openTool } from "./open-tool";

interface LauncherPageProps {
  manifests: readonly ToolManifest[];
  /** Opens a tool in its own window. Defaults to `window_open_tool`; tests pass a fake. */
  onOpen?: (manifest: ToolManifest) => Promise<void>;
  /** Reads the app version for the footer. Defaults to `app_info`; tests pass a fake. */
  loadAppInfo?: () => Promise<AppInfo>;
}

interface ToolCardProps {
  manifest: ToolManifest;
  onOpen: (manifest: ToolManifest) => Promise<void>;
}

function ToolCard({ manifest, onOpen }: ToolCardProps) {
  const Icon = manifest.icon;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    setPending(true);
    setError(null);
    try {
      await onOpen(manifest);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <Card data-testid={`tool-card-${manifest.id}`}>
      <CardHeader>
        <span className="mb-2 flex size-12 items-center justify-center rounded-pill bg-secondary text-primary">
          <Icon aria-hidden="true" className="size-6" />
        </span>
        <CardTitle>{manifest.displayName}</CardTitle>
        <CardDescription>{manifest.description}</CardDescription>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-2">
        {/* The tool opens in its own window: the launcher stays here to start the next one. */}
        <Button disabled={pending} onClick={() => void open()}>
          Open
          <ArrowRight aria-hidden="true" />
        </Button>
        {error ? (
          <p role="alert" className="text-sm">
            Could not open {manifest.displayName}: {error}
          </p>
        ) : null}
      </CardFooter>
    </Card>
  );
}

export function LauncherPage({
  manifests,
  onOpen = openTool,
  loadAppInfo = getAppInfo,
}: LauncherPageProps) {
  return (
    <main className="mx-auto flex min-h-full max-w-5xl flex-col gap-8 p-8">
      <header>
        <h1 className="text-3xl font-bold">ESEfact</h1>
        <p className="text-muted-foreground">Choose a tool to open.</p>
      </header>
      <section aria-label="Tools" className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {manifests.map((manifest) => (
          <ToolCard key={manifest.id} manifest={manifest} onOpen={onOpen} />
        ))}
      </section>
      <footer className="mt-auto">
        <AppVersion load={loadAppInfo} className="text-muted-foreground" />
      </footer>
    </main>
  );
}
