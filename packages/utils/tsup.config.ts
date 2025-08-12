import { defineConfig } from "tsup";
import { resolve } from "node:path";

export default defineConfig((options) => ({
  name: "@usex/utils",
  entry: ["src/index.ts"],
  splitting: true,
  format: ["esm", "cjs"],
  treeshake: true,
  watch: options.watch,
  external: [
    "@nestjs/common",
    "@nestjs/core",
    "@nestjs/microservices",
    "@nestjs/websockets",
    "cache-manager",
    "class-transformer",
    "class-validator",
    "fastify-swagger",
    "@fastify/swagger",
    "prisma",
    "rxjs",
    "nestjs-prisma",
    "reflect-metadata",
    "effect",
    "@nestjs/terminus",
    "@nestjs/swagger",
  ],
  target: "esnext",
  sourcemap: true,
  clean: true,
  dts: true,
  legacyOutput: false,
  minify: !options.watch,
  platform: "node",
  footer: {
    js: `// Generated on ${new Date().toISOString()}`,
  },
  banner: {
    js: `
// ----------------------------------------------------------
// @usex/utils
// A comprehensive utility library for Node.js/NestJS services & microservices
//
// License: Proprietary - © Sync Store, All Rights Reserved
//
// Author:     Ali Torki <ali_4286@live.com>
//
// ----------------------------------------------------------
  `,
  },
  tsconfig: resolve(__dirname, options.watch ? "tsconfig.json" : "tsconfig.build.json"),
}));
