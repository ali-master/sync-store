import { expect, test } from "bun:test";
import { MongoClient } from "mongodb";

test.skipIf(!process.env.TEST_API_URL || !process.env.TEST_DATABASE_URL)(
  "dashboard writes and lists the selected owner and hides deleted values",
  async () => {
    const client = await new MongoClient(process.env.TEST_DATABASE_URL!).connect();
    const user = "scope-check-" + crypto.randomUUID();
    let owner: string | undefined;
    const root = await client
      .db()
      .collection("api_keys")
      .findOne({
        _id: "sync-store-bootstrap-admin" as any,
      });
    const call = async (path: string, body?: unknown) => {
      const response = await fetch(`${process.env.TEST_API_URL}/api/v1/admin/${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: "Bearer " + root?.key,
          "x-user-id": user,
          "x-instance-id": "scope-test",
          "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await response.json();
      expect(response.ok, JSON.stringify(json)).toBe(true);
      return json.payload;
    };
    const path = `resources/storage?scopeUser=${user}&projectId=default&branch=main`;
    try {
      await call("storage", {
        userId: user,
        key: "probe",
        value: { checked: true },
        scope: { projectId: "default", branch: "main" },
      });
      const result = await call(path);
      expect(result.items.length).toBe(1);
      owner = result.items[0].userId;
      expect(result.items[0].key).toBe("probe");
      expect((await call(path.replace(user, "other-" + user))).items.length).toBe(0);
      await call("storage/delete", { userId: owner, key: "probe" });
      owner = undefined;
      expect((await call(path)).items.length).toBe(0);
    } finally {
      try {
        if (owner) await call("storage/delete", { userId: owner, key: "probe" });
      } finally {
        await client.close();
      }
    }
  },
);
