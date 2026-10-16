import { Suspense } from "react";
import type { RouteObject } from "react-router";
import { LauncherPage } from "@/launcher/LauncherPage";
import { tools } from "@/tools/registry";

const manifests = tools.map((tool) => tool.manifest);

export const routes: RouteObject[] = [
  { path: "/", element: <LauncherPage manifests={manifests} /> },
  ...tools.map(({ manifest, Page }) => ({
    path: manifest.route,
    element: (
      <Suspense fallback={null}>
        <Page />
      </Suspense>
    ),
  })),
];
