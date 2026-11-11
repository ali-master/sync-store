import { afterEach, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { about, parsePerson, repositoryUrl } from "../../src/domains/settings/about";
import { applyOverrides } from "../../src/domains/settings/settings.store";

// Kept apart from the Nest-based tests: this module needs no application code.
afterEach(async () => applyOverrides({}));

test("project information comes from package.json and its usual shorthand forms", async () => {
  expect(parsePerson("Ali Torki <ali@example.com> (https://github.com/ali-master)")).toEqual({
    name: "Ali Torki",
    email: "ali@example.com",
    url: "https://github.com/ali-master",
  });
  expect(parsePerson({ name: "Ali", url: 7 })).toEqual({ name: "Ali" });
  for (const [input, output] of [
    [
      "git+https://github.com/ali-master/sync-store.git",
      "https://github.com/ali-master/sync-store",
    ],
    ["git@github.com:ali-master/sync-store.git", "https://github.com/ali-master/sync-store"],
    ["github:ali-master/sync-store", "https://github.com/ali-master/sync-store"],
    ["ali-master/sync-store", "https://github.com/ali-master/sync-store"],
    ["gitlab:group/project", "https://gitlab.com/group/project"],
  ])
    expect(repositoryUrl({ url: input })).toBe(output);
  expect(repositoryUrl("javascript:alert(1)")).toBeNull();

  const directory = await mkdtemp(join(tmpdir(), "about-"));
  const file = join(directory, "package.json");
  await writeFile(
    file,
    JSON.stringify({
      name: "@usex/api",
      version: "1.2.3",
      author: "Ali <a@example.com> (https://github.com/ali-master)",
      repository: "github:ali-master/sync-store",
      homepage: "https://docs.example.com",
      bugs: "javascript:alert(1)",
    }),
  );
  applyOverrides({ API_URL: "https://sync.example.com/api" });
  expect(await about(file)).toMatchObject({
    version: "1.2.3",
    author: { url: "https://github.com/ali-master" },
    repositoryUrl: "https://github.com/ali-master/sync-store",
    issuesUrl: "https://github.com/ali-master/sync-store/issues",
    docsUrl: "https://docs.example.com",
    endpoints: { mcp: "https://sync.example.com/mcp", metrics: "https://sync.example.com/metrics" },
  });
  // Edits are read on the next request, without a restart.
  await writeFile(file, JSON.stringify({ version: "2.0.0" }));
  expect((await about(file)).version).toBe("2.0.0");
  // The real manifest is found from this file's location.
  expect((await about()).name).toBe("@usex/api");
});
