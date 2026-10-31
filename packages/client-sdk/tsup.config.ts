import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/react.ts", "src/legacy.ts", "src/advanced.ts"],
  format: ["cjs", "esm"],
  dts: true,
  splitting: true,
  sourcemap: true,
  clean: true,
  minify: true,
  target: "es2020",
  outDir: "dist",
  external: ["socket.io-client", "react"],
});
