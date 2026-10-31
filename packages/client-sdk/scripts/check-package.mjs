import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const sdk = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(readFileSync(join(sdk, "package.json"), "utf8"));
const consumer = mkdtempSync(join(tmpdir(), "sync-store-consumer-"));

/** Exercise the packed SDK outside the workspace so missing exports cannot hide behind source aliases. */
function run(command, args, cwd = consumer) {
  execFileSync(command, args, { cwd, stdio: "inherit", timeout: 180_000 });
}

try {
  const archive = join(consumer, "sdk.tgz");
  run("bun", ["pm", "pack", "--filename", archive], sdk);
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true }));
  run("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--omit=optional",
    archive,
  ]);
  // The core and advanced entry points must work without the optional React peer.
  run("node", [
    "--input-type=module",
    "-e",
    `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    const require = createRequire(import.meta.url);
    assert.throws(() => require.resolve('react'));
    for (const name of ['@usex/sync-store', '@usex/sync-store/advanced']) {
      assert.ok(await import(name));
      assert.ok(require(name));
    }
  `,
  ]);
  run("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    `react@${manifest.devDependencies.react}`,
    `@types/react@${manifest.devDependencies["@types/react"]}`,
    `@types/node@${manifest.devDependencies["@types/node"]}`,
    `typescript@${manifest.devDependencies.typescript}`,
  ]);
  const installed = join(consumer, "node_modules/@usex/sync-store");
  for (const entry of Object.values(manifest.exports)) {
    for (const path of Object.values(entry)) assert.ok(readFileSync(join(installed, path)).length);
  }
  writeFileSync(
    join(consumer, "runtime.mjs"),
    `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
for (const load of [name => import(name), name => require(name)]) {
  const core = await load('@usex/sync-store');
  const advanced = await load('@usex/sync-store/advanced');
  assert.equal(typeof (await load('@usex/sync-store/react')).SyncProvider, 'function');
  assert.equal(typeof (await load('@usex/sync-store/legacy')).useRemoteStorage, 'function');
  assert.equal(typeof core.SyncStore, 'function');
  const emitter = new advanced.EventEmitter();
  let received;
  emitter.on('value', value => { received = value; });
  await emitter.emit('value', 42);
  assert.equal(received, 42);
  const client = core.createRemoteStorage({ userId: 'consumer', autoConnect: false, mode: 'http' });
  try {
    await client.setItem('value', { count: 42 });
    assert.deepEqual(client.getItem('value'), { count: 42 });
    await client.removeItem('value');
    assert.equal(client.getItem('value'), null);
  } finally { client.destroy(); }
}
`,
  );
  run("node", ["runtime.mjs"]);
  run("bun", ["runtime.mjs"]);
  const source = `
import { createRemoteStorage, SyncStore } from '@usex/sync-store';
import { EventEmitter, HttpTransport, TransportMode, type BatchOperation, type BatchResult, type SyncFilter } from '@usex/sync-store/advanced';
import { SyncProvider } from '@usex/sync-store/react';
import { useRemoteStorage } from '@usex/sync-store/legacy';
export const store = createRemoteStorage({ userId: 'types', autoConnect: false });
export const connect = SyncStore;
export const emitter = new EventEmitter<{ value: number }>();
export const transport = new HttpTransport({ serverUrl: 'http://localhost', userId: 'types', instanceId: 'test', mode: TransportMode.HTTP });
export const provider = SyncProvider;
export const legacy = useRemoteStorage;
export const batch = (operations: BatchOperation[]): Promise<BatchResult> => store.executeBatch(operations);
export const filter = (value: SyncFilter) => store.setSyncFilter(value);
// @ts-expect-error event payloads must keep their declared type
emitter.emit('value', 'invalid');
`;
  for (const ext of ["mts", "cts"]) writeFileSync(join(consumer, `consumer.${ext}`), source);
  run("node", [
    "node_modules/typescript/bin/tsc",
    "--strict",
    "--declaration",
    "--emitDeclarationOnly",
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "--target",
    "ES2022",
    "consumer.mts",
    "consumer.cts",
  ]);
  run("node", [
    "node_modules/typescript/bin/tsc",
    "--strict",
    "--noEmit",
    "--module",
    "ESNext",
    "--moduleResolution",
    "bundler",
    "--target",
    "ES2022",
    "consumer.mts",
  ]);
  run("bun", ["build", "consumer.mts", "--target", "browser", "--outfile", "browser.js"]);
  console.log(
    "Packed SDK passed npm installation, Node/Bun runtime and consumer declaration checks.",
  );
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
