import { createMDX } from "fumadocs-mdx/next";
// Types
import type { NextConfig } from "next";

const withMDX = createMDX();
const nextConfig: NextConfig = {
  poweredByHeader: false,
  cleanDistDir: true,
  compress: true,
  generateEtags: true,
  reactStrictMode: true,
};

export default withMDX(nextConfig);
