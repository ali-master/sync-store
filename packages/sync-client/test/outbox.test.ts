import { expect, test } from "bun:test";
import { RemoteStorage } from "../src/remote-storage";

test("outbox duplicates and delayed versions cannot resurrect a removed value", async () => {
  const client = new RemoteStorage({ userId: crypto.randomUUID(), autoConnect: false });
  const internal = client as any;
  const event = { key: "item", recordId: "record", timestamp: 100, source: "remote" };
  let changes = 0;
  client.on("change", () => {
    changes++;
  });
  try {
    await internal.handleRemoteUpdate({ ...event, type: "sync", value: false, version: 1 });
    await internal.handleRemoteUpdate({ ...event, type: "sync", value: false, version: 1 });
    expect(changes).toBe(1);
    await internal.handleRemoteRemove({ ...event, type: "remove", version: 2 });
    await internal.handleRemoteUpdate({ ...event, type: "sync", value: "stale", version: 1 });
    expect(client.getItem("item")).toBe(null);
    expect(changes).toBe(2);
    await internal.handleRemoteUpdate({ ...event, type: "sync", value: 0, version: 3 });
    expect(client.getItem("item")).toBe(0);
  } finally {
    client.destroy();
  }
});
