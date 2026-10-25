import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  base: "/dashboard/",
  server: { proxy: { "/api": process.env.API_PROXY_TARGET || "http://localhost:3000" } },
});
