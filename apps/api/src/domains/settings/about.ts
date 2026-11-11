import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setting } from "./settings.store";

type Person = { name?: string; email?: string; url?: string };

/** npm allows "Name <email> (url)" as well as an object. */
export function parsePerson(value: unknown): Person | null {
  if (value && typeof value === "object") {
    const { name, email, url } = value as Record<string, unknown>;
    return {
      ...(typeof name === "string" ? { name } : {}),
      ...(typeof email === "string" ? { email } : {}),
      ...(typeof url === "string" ? { url } : {}),
    };
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  const between = (open: string, close: string) => {
    const start = text.indexOf(open);
    const end = text.indexOf(close, start + 1);
    return start !== -1 && end > start ? text.slice(start + 1, end).trim() : "";
  };
  const name = text.split(/[<(]/, 1)[0].trim();
  const email = between("<", ">");
  const url = between("(", ")");
  return { ...(name ? { name } : {}), ...(email ? { email } : {}), ...(url ? { url } : {}) };
}

const hosts: Record<string, string> = {
  github: "github.com",
  gitlab: "gitlab.com",
  bitbucket: "bitbucket.org",
};

/** "git+https://github.com/o/r.git", "github:o/r" and "o/r" all become a browsable https URL. */
export function repositoryUrl(value: unknown): string | null {
  const raw = typeof value === "string" ? value : (value as { url?: unknown } | null)?.url;
  if (typeof raw !== "string" || !raw.trim()) return null;
  let url = raw.trim();
  const shorthand = url.match(/^(?:(github|gitlab|bitbucket):)?([\w.-]+\/[\w.-]+)$/);
  if (shorthand) url = `https://${hosts[shorthand[1] ?? "github"]}/${shorthand[2]}`;
  url = url
    .replace(/^git\+/, "")
    .replace(/^git@([^:]+):/, "https://$1/")
    .replace(/^(ssh|git):\/\/(git@)?/, "https://")
    .replace(/\.git$/, "");
  return /^https?:\/\//.test(url) ? url : null;
}

function link(value: unknown): string | null {
  const url = typeof value === "string" ? value : (value as { url?: unknown } | null)?.url;
  return typeof url === "string" && /^https?:\/\//.test(url) ? url : null;
}

/** The API's own package.json: apps/api, three levels above this file in src and in dist. */
const manifest = join(__dirname, "..", "..", "..", "package.json");

/** The public origin applications use: the API_URL setting without any path. */
export function publicOrigin(): string | null {
  try {
    return new URL(setting("API_URL") ?? "http://localhost:3000").origin;
  } catch {
    return null;
  }
}

/**
 * Describe the project from its package.json, read on every request so an edited manifest shows
 * up in the dashboard without a rebuild, plus the addresses of this installation.
 */
export async function about(path = manifest) {
  const pkg = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  const repository = repositoryUrl(pkg.repository);
  const publicUrl = publicOrigin();
  return {
    name: typeof pkg.name === "string" ? pkg.name : null,
    description: typeof pkg.description === "string" ? pkg.description : null,
    version: typeof pkg.version === "string" ? pkg.version : null,
    license: typeof pkg.license === "string" ? pkg.license : null,
    author: parsePerson(pkg.author),
    contributors: Array.isArray(pkg.contributors)
      ? pkg.contributors.map(parsePerson).filter(Boolean)
      : [],
    repositoryUrl: repository,
    issuesUrl:
      link(pkg.bugs) ?? (repository?.includes("github.com") ? repository + "/issues" : null),
    docsUrl: link(pkg.homepage),
    keywords: Array.isArray(pkg.keywords)
      ? pkg.keywords.filter((keyword) => typeof keyword === "string")
      : [],
    runtime: { bun: process.versions.bun ?? null, node: process.versions.node },
    publicUrl,
    endpoints: publicUrl
      ? {
          api: publicUrl + "/api/v1",
          openapi: publicUrl + "/api/docs",
          mcp: publicUrl + "/mcp",
          metrics: publicUrl + "/metrics",
          dashboard: publicUrl + "/dashboard/",
        }
      : null,
  };
}
