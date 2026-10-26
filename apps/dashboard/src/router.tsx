import { createRootRoute, createRoute, createRouter, Link, Outlet } from "@tanstack/react-router";
import App from "./App";
import { SessionProvider } from "./lib/session";
import { validateSearch } from "./lib/search";
import { Onboarding } from "./components/onboarding";

const rootRoute = createRootRoute({
  component: () => (
    <SessionProvider>
      <Onboarding>
        <Outlet />
      </Onboarding>
    </SessionProvider>
  ),
  notFoundComponent: () => (
    <main className="grid min-h-screen place-content-center gap-4 text-center">
      <h1 className="text-3xl font-semibold">Page not found</h1>
      <Link to="/">Return to your console</Link>
    </main>
  ),
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
