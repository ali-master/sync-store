import { RootProvider } from "fumadocs-ui/provider";
import { Inter, JetBrains_Mono } from "next/font/google";
// Types
import type { ReactNode } from "react";
// Styles
import "./global.css";

const inter = Inter({
  subsets: ["latin"],
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.className} ${mono.variable}`} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <RootProvider
          theme={{
            enableColorScheme: true,
            enabled: true,
            enableSystem: true,
          }}
        >
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
