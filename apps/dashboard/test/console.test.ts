import { expect, test } from "bun:test";
import { validateSearch } from "../src/lib/search";
import { createConsoleQueryClient } from "../src/lib/session";

test("URL search cannot send invalid pagination or oversized filters to the API", () => {
  for (const page of [0, -1, 1.5, "invalid", 10001, Infinity])
    expect(validateSearch({ page }).page).toBe(1);
  expect(validateSearch({ page: "2", q: "workspace" })).toEqual({ page: 2, q: "workspace" });
  expect(validateSearch({ q: { $ne: null } }).q).toBe("");
  expect(validateSearch({ q: "x".repeat(700) }).q).toHaveLength(500);
});

test("refresh invalidates only the current installation session", async () => {
  const client = createConsoleQueryClient();
  client.setQueryData(["console", "first", "records", "keys", 1, ""], { items: [] });
  client.setQueryData(["console", "second", "overview"], { users: 2 });
  await client.invalidateQueries({ queryKey: ["console", "first"] });
  expect(client.getQueryState(["console", "first", "records", "keys", 1, ""])?.isInvalidated).toBe(
    true,
  );
  expect(client.getQueryState(["console", "second", "overview"])?.isInvalidated).toBe(false);
  client.clear();
});

test("sign-out cancellation and cache clearing discard pending private data", async () => {
  const client = createConsoleQueryClient();
  let aborted = false;
  const pending = client
    .fetchQuery({
      queryKey: ["console", "session", "overview"],
      queryFn: ({ signal }) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("cancelled"));
          });
        }),
    })
    .catch(() => undefined);
  await client.cancelQueries();
  client.clear();
  await pending;
  expect(aborted).toBe(true);
  expect(client.getQueryCache().getAll()).toEqual([]);
  expect(client.getDefaultOptions().mutations?.retry).toBe(false);
});

test("data scope survives navigation as bounded strings and resets without a user", () => {
  expect(
    validateSearch({
      scopeUser: " customer ",
      projectId: "app",
      branch: "preview",
      tenantId: "team",
    }),
  ).toMatchObject({ scopeUser: "customer", projectId: "app", branch: "preview", tenantId: "team" });
  expect(validateSearch({ scopeUser: { $ne: null }, tenantId: "other" })).toEqual({
    page: 1,
    q: "",
  });
  expect(validateSearch({ scopeUser: "x".repeat(200) }).scopeUser).toHaveLength(128);
});
