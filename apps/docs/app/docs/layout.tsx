import { source } from "@root/lib/source";
import { DocsLayout } from "fumadocs-ui/layouts/notebook";
import type { ReactNode } from "react";
import { baseOptions } from "@root/app/layout.config";

export default function RootDocsLayout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      tabMode="sidebar"
      nav={{ ...baseOptions.nav, mode: "top" }}
      sidebar={
        {
          // banner: <div>Hello World</div>,
        }
      }
      {...baseOptions}
    >
      {children}
    </DocsLayout>
  );
}
