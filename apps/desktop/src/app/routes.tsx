import { Suspense } from "react";
import type { RouteObject } from "react-router";
import { LauncherPage } from "@/launcher/LauncherPage";
import { tools } from "@/tools/registry";

const manifests = tools.map((tool) => tool.manifest);

export const routes: RouteObject[] = [
  { path: "/", element: <LauncherPage manifests={manifests} /> },
  ...tools.flatMap(({ manifest, Page, extraRoutes = [] }) =>
    [{ path: manifest.route, Page }, ...extraRoutes].map(({ path, Page: RoutePage }) => ({
      path,
      element: (
        <Suspense fallback={null}>
          <RoutePage />
        </Suspense>
      ),
    })),
  ),
];
