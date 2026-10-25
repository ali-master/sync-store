/** Bounded fault test for the disposable sync-store-cluster installation only. */
const worker = process.argv.includes("--worker");
const prefix = "sync-store-cluster";
const combined = process.argv.includes("--combined");
const outbox = process.argv.includes("--outbox");
const crashNode = "sync-store-outbox-crash-api";

if (!worker) {
  const docker = async (...args: string[]) => {
    const p = Bun.spawn(["docker", ...args], { stdout: "pipe", stderr: "pipe" });
    const output = await new Response(p.stdout).text();
    const error = await new Response(p.stderr).text();
    if (await p.exited) throw new Error(error);
    return output;
  };
  if (outbox) {
    await docker("exec", `${prefix}-api-2`, "rm", "-f", "/tmp/outbox-crash-event.json");
    await docker(
      "compose",
      "--env-file",
      "/tmp/sync-store-e2e.env",
      "-p",
      prefix,
      "-f",
      "compose.yml",
      "-f",
      "compose.scale.yml",
      "run",
      "-d",
      "--no-deps",
      "--name",
      crashNode,
      "-v",
      `${process.cwd()}/scripts/outbox-crash-preload.ts:/app/apps/api/outbox-crash-preload.ts:ro`,
      "api",
      "bun",
      "--preload",
      "./outbox-crash-preload.ts",
      "--tsconfig-override",
      "tsconfig.runtime.json",
      "dist/main.js",
    );
    await Bun.sleep(5000);
  }
  await docker("cp", import.meta.path, `${prefix}-api-2:/app/apps/api/fault-load.ts`);
  const child = Bun.spawn(
    [
      "docker",
      "exec",
      `${prefix}-api-2`,
      "bun",
      "/app/apps/api/fault-load.ts",
      "--worker",
      ...(outbox ? ["--outbox"] : []),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const errors = new Response(child.stderr).text();
  let faults: Promise<void> | undefined;
  try {
    for await (const chunk of child.stdout) {
      const text = new TextDecoder().decode(chunk);
      process.stdout.write(text);
      if (text.includes("LOAD_READY") && !faults)
        faults = (async () => {
          if (outbox) {
            const deadline = Date.now() + 30000;
            while (Date.now() < deadline) {
              const log = await docker("logs", crashNode);
              const match = log.match(/OUTBOX_BEFORE_PUBLISH (\{[^\n]+\})/);
              if (match) {
                const event = JSON.parse(match[1]);
                console.log("FAULT committed event held before publish", event.eventId);
                await Bun.write("/tmp/sync-outbox-crash-event.json", JSON.stringify(event));
                await docker(
                  "cp",
                  "/tmp/sync-outbox-crash-event.json",
                  `${prefix}-api-2:/tmp/outbox-crash-event.json`,
                );
                await docker("kill", "--signal", "KILL", crashNode);
                console.log(
                  "FAULT backend killed before publication; surviving replicas must recover its lease",
                );
                return;
              }
              await Bun.sleep(100);
            }
            throw new Error("Crash failpoint never reached");
          }
          await Bun.sleep(12000);
          console.log("FAULT redis stop");
          await docker("stop", "-t", "1", `${prefix}-redis-1`);
          if (combined) {
            await Bun.sleep(3000);
            console.log("FAULT backend SIGKILL while Redis is down");
            await docker("stop", "-t", "0", `${prefix}-api-1`);
          }
          await Bun.sleep(10000);
          await docker("start", `${prefix}-redis-1`);
          console.log("RECOVERY redis started");
          if (combined) {
            await Bun.sleep(3000);
            await docker("start", `${prefix}-api-1`);
            console.log("RECOVERY backend started");
            return;
          }
          await Bun.sleep(12000);
          console.log("FAULT backend SIGKILL");
          await docker("stop", "-t", "0", `${prefix}-api-1`);
          await Bun.sleep(8000);
          await docker("start", `${prefix}-api-1`);
          console.log("RECOVERY backend started");
        })();
    }
    await faults;
    const exit = await child.exited;
    if (exit) console.error((await errors).slice(-2000));
    process.exitCode = exit;
  } finally {
    await docker("start", `${prefix}-redis-1`, `${prefix}-api-1`);
    if (outbox) await docker("rm", "-f", crashNode);
  }
} else {
  const { MongoClient } = await import("mongodb");
  // This script is copied inside the API image so it tests the deployed SDK source.
  const { RemoteStorage } = await import("../../packages/sync-client/src/remote-storage.ts");
  const db = new MongoClient(process.env.DATABASE_URL!);
  await db.connect();
  const key = await db.db().collection("api_keys").findOne({ name: "Cluster test key" });
  if (!key) throw new Error("Disposable cluster test key is required");
  const run = `load-${crypto.randomUUID()}`;
  const readers = Array.from(
    { length: 12 },
    (_, i) =>
      new RemoteStorage({
        serverUrl:
          outbox || !(i % 2) ? "http://sync-store-cluster-api-2:3000" : "http://proxy:3000",
        apiKey: key.key,
        userId: `${run}-${i}`,
        instanceId: "reader",
        mode: "websocket",
        autoConnect: false,
        timeout: 5000,
      }),
  );
  const received = new Set<string>();
  let duplicateEvents = 0;
  let retriedRequests = 0;
  for (const reader of readers)
    reader.on("sync", (event: any) => {
      if (event.eventId) {
        if (received.has(event.eventId)) duplicateEvents++;
        received.add(event.eventId);
      }
    });
  const ledger: Array<{
    user: number;
    key: string;
    value: string;
    ok: boolean;
    ms: number;
    status: number;
    eventId?: string;
  }> = [];
  const pending = new Set<Promise<void>>();
  try {
    await Promise.all(readers.map((r) => r.connect()));
    console.log("LOAD_READY", run);
    const started = Date.now();
    for (let n = 0; n < 1800; n++) {
      const user = n % readers.length;
      const entry: (typeof ledger)[number] = {
        user,
        key: `item-${n}`,
        value: `${run}:${n}:` + "x".repeat(256),
        ok: false,
        ms: 0,
        status: 0,
      };
      ledger.push(entry);
      const request = (async () => {
        const t = Date.now();
        const origins =
          outbox && n < 120
            ? [`http://${crashNode}:3000`, "http://proxy:3000"]
            : ["http://proxy:3000"];
        for (const origin of origins) {
          try {
            const res = await fetch(`${origin}/api/v1/item/${entry.key}`, {
              method: "PUT",
              headers: {
                "x-api-key": key.key,
                "x-user-id": `${run}-${user}`,
                "x-instance-id": "writer",
                "content-type": "application/json",
              },
              body: JSON.stringify({ value: entry.value }),
              signal: AbortSignal.timeout(5000),
            });
            const body = await res.json();
            entry.status = res.status;
            entry.ok = res.ok;
            const item = body.payload ?? body;
            if (res.ok) entry.eventId = `${item.id}:${item.version}`;
          } catch {
            entry.status = 0;
          }
          if (entry.ok) break;
          if (origin !== origins.at(-1)) retriedRequests++;
        }
        entry.ms = Date.now() - t;
      })();
      pending.add(request);
      void request.finally(() => pending.delete(request));
      await Bun.sleep(Math.max(0, started + (n + 1) * (1000 / 30) - Date.now()));
    }
    await Promise.all(pending);
    await Bun.sleep(15000);
    const records = await db
      .db()
      .collection("sync_storage_items")
      .find({ userId: { $in: readers.map((_, i) => `${run}-${i}`) } })
      .toArray();
    const stored = new Map(records.map((r) => [`${r.userId}/${r.key}`, JSON.parse(r.value)]));
    const accepted = ledger.filter((e) => e.ok);
    const missing = accepted.filter((e) => stored.get(`${run}-${e.user}/${e.key}`) !== e.value);
    const stale = () => accepted.filter((e) => readers[e.user].getItem(e.key) !== e.value).length;
    const staleBeforeReconnect = stale();
    const receivedBeforeReconnect = new Set(received);
    for (const r of readers) {
      r.disconnect();
      await r.connect();
    }
    const latencies = accepted.map((e) => e.ms).sort((a, b) => a - b);
    const crashEvent = outbox ? await Bun.file("/tmp/outbox-crash-event.json").json() : undefined;
    if (crashEvent && !crashEvent.userId.startsWith(run + "-"))
      throw new Error("Failpoint did not capture this run's event");
    const missingEvents = outbox
      ? accepted.filter((e) => !e.eventId || !receivedBeforeReconnect.has(e.eventId)).length
      : undefined;
    const crashEventReceived = crashEvent ? receivedBeforeReconnect.has(crashEvent.eventId) : undefined;
    const pendingEvents = records.reduce((n, r) => n + (r.outbox?.length ?? 0), 0);
    const report = {
      run,
      requested: ledger.length,
      accepted: accepted.length,
      failed: ledger
        .filter((e) => !e.ok)
        .reduce(
          (acc, e) => ({ ...acc, [e.status]: (acc[e.status] ?? 0) + 1 }),
          {} as Record<number, number>,
        ),
      persisted: records.length,
      missingAcknowledged: missing.length,
      staleBeforeReconnect,
      staleAfterReconnect: stale(),
      missingEvents,
      crashEventReceived,
      pendingEvents,
      duplicateEvents,
      latencyMs: {
        p50: latencies[Math.floor(latencies.length * 0.5)],
        p95: latencies[Math.floor(latencies.length * 0.95)],
        p99: latencies[Math.floor(latencies.length * 0.99)],
      },
    };
    console.log("LOAD_REPORT", JSON.stringify({ ...report, retriedRequests }));
    if (
      missing.length ||
      report.staleAfterReconnect ||
      staleBeforeReconnect ||
      accepted.length < 1700 ||
      pendingEvents ||
      (outbox && (missingEvents || !crashEventReceived))
    )
      process.exitCode = 1;
  } finally {
    readers.forEach((r) => r.destroy());
    await db.close();
  }
}
