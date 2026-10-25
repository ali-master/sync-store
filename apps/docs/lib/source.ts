import { loader } from "fumadocs-core/source";
import { openapiPlugin, createOpenAPI } from "fumadocs-openapi/server";
import { docs } from "@root/.source/server";

export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
  plugins: [openapiPlugin()],
});

export const openapi = createOpenAPI();
