import { useNavigate } from "@tanstack/react-router";
import {
  Activity,
  Archive,
  BarChart3,
  Database,
  Gauge,
  GitBranch,
  History,
  Info,
  KeyRound,
  Layers,
  LayoutDashboard,
  type LucideIcon,
  Network,
  PlugZap,
  ScrollText,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Unplug,
  Users,
} from "lucide-react";
import {
  AnimatedSidebarGroup,
  AnimatedSidebarGroupContent,
  AnimatedSidebarGroupLabel,
  AnimatedSidebarMenu,
  AnimatedSidebarMenuButton,
  AnimatedSidebarMenuItem,
} from "@/components/motion/animated-sidebar";
import type { DataScope } from "./data-scope";

export type NavItem = { id: string; title: string; icon: LucideIcon };

/** One source for the sidebar and the command palette, so a page is never reachable from only one. */
export const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "Start",
    items: [
      { id: "connect", title: "Connect your app", icon: PlugZap },
      { id: "overview", title: "Overview", icon: LayoutDashboard },
    ],
  },
  {
    label: "Data",
    items: [
      { id: "storage", title: "Data explorer", icon: Database },
      { id: "versioning", title: "Branches & commits", icon: GitBranch },
      { id: "history", title: "Version history", icon: History },
    ],
  },
  {
    label: "Access",
    items: [
      { id: "keys", title: "API keys", icon: KeyRound },
      { id: "projects", title: "Projects", icon: Layers },
      { id: "tenants", title: "Tenants", icon: Users },
    ],
  },
  {
    label: "Monitor",
    items: [
      { id: "health", title: "Sync health", icon: Activity },
      { id: "usage", title: "Usage & quotas", icon: Gauge },
      { id: "changes", title: "Changes & growth", icon: BarChart3 },
      { id: "sessions", title: "Connections", icon: Network },
      { id: "audits", title: "Activity log", icon: ScrollText },
    ],
  },
  {
    label: "Advanced",
    items: [
      { id: "conflicts", title: "Conflicts", icon: Unplug },
      { id: "quotas", title: "User quotas", icon: ShieldCheck },
      { id: "analytics", title: "Analytics records", icon: BarChart3 },
      { id: "archives", title: "Archives", icon: Archive },
    ],
  },
  {
    label: "Installation",
    items: [
      { id: "settings", title: "Settings", icon: SlidersHorizontal },
      { id: "system", title: "System", icon: Settings2 },
      { id: "about", title: "About", icon: Info },
    ],
  },
];

/** Tenants and settings are platform concerns; a tenant administrator never sees them. */
export function visibleNav(platform: boolean) {
  return navGroups.map((group) => ({
    ...group,
    items: group.items.filter((item) => platform || !["tenants", "settings"].includes(item.id)),
  }));
}

/** Navigate between views while keeping the selected data scope. */
export function useSectionNavigate(scope: DataScope) {
  const navigate = useNavigate();
  return (id: string) =>
    void navigate({ to: id === "overview" ? "/" : "/" + id, search: { ...scope, page: 1, q: "" } });
}

/** The grouped pages of the console, inside the animated sidebar. */
export function ConsoleNav({
  section,
  platform,
  busy,
  scope,
}: {
  section: string;
  platform: boolean;
  busy: boolean;
  scope: DataScope;
}) {
  const go = useSectionNavigate(scope);
  return (
    <>
      {visibleNav(platform).map((group) => (
        <AnimatedSidebarGroup key={group.label}>
          <AnimatedSidebarGroupLabel>{group.label}</AnimatedSidebarGroupLabel>
          <AnimatedSidebarGroupContent>
            <AnimatedSidebarMenu>
              {group.items.map(({ id, title, icon: Icon }) => (
                <AnimatedSidebarMenuItem key={id}>
                  <AnimatedSidebarMenuButton
                    icon={<Icon className="size-4" />}
                    isActive={section === id}
                    disabled={busy}
                    onSelect={() => go(id)}
                  >
                    {title}
                  </AnimatedSidebarMenuButton>
                </AnimatedSidebarMenuItem>
              ))}
            </AnimatedSidebarMenu>
          </AnimatedSidebarGroupContent>
        </AnimatedSidebarGroup>
      ))}
    </>
  );
}
