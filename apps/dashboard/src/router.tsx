import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import App from "./App";
import { SessionProvider } from "./lib/session";
import { validateSearch } from "./lib/search";
import { NotFoundTerminal } from "./components/motion/not-found/terminal";
import { Onboarding } from "./components/onboarding";

/**
 * The block links with plain anchors. A full page load would end the in-memory session, so the
 * link back to the console is handed to the router instead.
 */
function NotFound() {
  const navigate = useNavigate();
  const home = useRouter().basepath + "/";
  return (
    <main
      className="grid min-h-screen place-items-center bg-background"
      onClick={(event) => {
        const link = (event.target as HTMLElement).closest("a");
        if (link?.getAttribute("href") !== home) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        void navigate({ to: "/" });
      }}
    >
      <NotFoundTerminal
        description="This address does not match a page in your console."
        homeHref={home}
        homeLabel="Return to your console"
        browseHref="/api/docs"
        browseLabel="API reference"
      />
    </main>
  );
}

const rootRoute = createRootRoute({
  component: () => (
    <SessionProvider>
      <Onboarding>
        <Outlet />
      </Onboarding>
    </SessionProvider>
  ),
  notFoundComponent: NotFound,
});
const sections = [
  "connect",
  "health",
  "usage",
  "changes",
  "overview",
  "storage",
  "keys",
  "projects",
  "tenants",
  "versioning",
  "history",
  "sessions",
  "conflicts",
  "quotas",
  "audits",
  "analytics",
  "archives",
  "system",
  "settings",
];
const routes = sections.map((section) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: section === "overview" ? "/" : section,
    validateSearch,
    component: () => <App key={section} section={section} />,
  }),
);

export const router = createRouter({
  routeTree: rootRoute.addChildren(routes),
  basepath: "/dashboard",
  scrollRestoration: true,
});
