import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { Logo } from "./logo";

export const baseOptions: BaseLayoutProps = {
  nav: {
    title: (
      <span className="site-brand">
        <Logo />
        <span>Sync Store</span>
      </span>
    ),
  },
  githubUrl: "https://github.com/ali-master/sync-store",
  links: [
    { text: "Documentation", url: "/docs" },
    { text: "Playground", url: "/docs/playground" },
  ],
  themeSwitch: {
    enabled: true,
    mode: "light-dark",
  },
  searchToggle: {
    enabled: true,
  },
};
