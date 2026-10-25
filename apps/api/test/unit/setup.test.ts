import "reflect-metadata";
import { expect, test } from "bun:test";
import { SetupService } from "../../src/domains/admin/setup.service";

/** Model the unique administrator insert to verify that setup cannot be claimed twice. */
function fixture() {
  let admin: any = null;
  const code = "a".repeat(64);
  const db = {
    native: { collection: () => ({ findOne: async () => ({ code }) }) },
    orm: {
      api_keys: {
        where: () => ({ first: async () => admin }),
        create: async (value: any) => {
          if (admin) throw new Error("duplicate");
          admin = value;
        },
      },
    },
  };
  return { service: new SetupService(db as any), code, admin: () => admin };
}

test("setup requires server ownership and valid administrator input", async () => {
  const f = fixture();
  expect(await f.service.status()).toEqual({ required: true });
  for (const body of [
    null,
    { code: f.code, name: " " },
    { code: "b".repeat(64), name: "Admin" },
    { code: [], name: "Admin" },
  ]) {
    await expect(f.service.complete(body)).rejects.toThrow();
  }
  expect(f.admin()).toBeNull();
});

test("concurrent setup creates exactly one administrator and permanently closes setup", async () => {
  const f = fixture();
  const results = await Promise.allSettled([
    f.service.complete({ code: f.code, name: " Owner " }),
    f.service.complete({ code: f.code, name: "Other" }),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(f.admin().name).toBe("Owner");
  expect(f.admin().key).toMatch(/^ss_admin_[a-f0-9]{64}$/);
  expect(await f.service.status()).toEqual({ required: false });
  f.admin().isActive = false;
  await expect(f.service.complete({ code: f.code, name: "Again" })).rejects.toThrow(
    "already complete",
  );
});
