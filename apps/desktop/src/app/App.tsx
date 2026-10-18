import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { useAltGuard } from "@/shared/lib/alt-guard";
import { routes } from "./routes";

const router = createBrowserRouter(routes);

export function App() {
  // Once per window (launcher, connection window, poll windows): a lone Alt tap never reaches the OS menu.
  useAltGuard();
  return <RouterProvider router={router} />;
}
