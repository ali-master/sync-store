import type { Metadata } from "next";

const description =
  "Real-time synchronized storage for connected apps. Built with Bun and TypeScript.";
const siteUrl =
  process.env.SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:4000");
const image = {
  url: "/brand/social-preview.png",
  width: 1280,
  height: 640,
  alt: "Sync Store — Everything. In sync.",
};

export const siteMetadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "Sync Store — Everything. In sync.", template: "%s | Sync Store" },
  description,
  openGraph: {
    type: "website",
    siteName: "Sync Store",
    title: "Sync Store — Everything. In sync.",
    description,
    images: [image],
  },
  twitter: {
    card: "summary_large_image",
    title: "Sync Store — Everything. In sync.",
    description,
    images: [image],
  },
};
