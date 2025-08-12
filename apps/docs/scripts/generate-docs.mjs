import * as OpenAPI from "fumadocs-openapi";
import { rimraf } from "rimraf";

const out = "./content/docs/(api)";

async function generate() {
  // clean generated files
  await rimraf(out, {
    filter(v) {
      return !v.endsWith("index.mdx") && !v.endsWith("meta.json");
    },
  });

  await OpenAPI.generateFiles({
    // input files
    input: ["https://gateway.local/api/docs/openapi.json"],
    output: out,
    addGeneratedComment: true,
    groupBy: "tag",
    per: "operation",
    includeDescription: true,
  });
}

void generate();
