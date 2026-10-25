import { useEffect, useRef, useState } from "react";
import { RemoteStorage } from "@usex/sync-client";
import logo from "../../../assets/logo.svg";
import "./App.css";

type Entry = { key: string; value: unknown };
type Pair = [RemoteStorage, RemoteStorage];
type Activity = { id: string; time: string; client: string; message: string };
const sample = JSON.stringify({ theme: "midnight", notifications: true, language: "en" }, null, 2);

/** Keep each browser tab's playground identity stable without storing credentials. */
function tabIdentity() {
  try {
    const id = sessionStorage.getItem("sync-playground-tab") || crypto.randomUUID();
    sessionStorage.setItem("sync-playground-tab", id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

/** Two independently cached SDK clients demonstrate real server-mediated synchronization. */
export default function App() {
  const [tabId] = useState(tabIdentity);
  const [serverUrl, setServerUrl] = useState("http://localhost:3000");
  const [apiKey, setApiKey] = useState("");
  const [userId, setUserId] = useState(() => "demo-" + tabId.slice(0, 8));
  const [mode, setMode] = useState<"websocket" | "http">("websocket");
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState([false, false]);
  const [snapshots, setSnapshots] = useState<Entry[][]>([[], []]);
  const [key, setKey] = useState("preferences");
  const [draft, setDraft] = useState(sample);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [events, setEvents] = useState<Activity[]>([]);
  const clients = useRef<Pair | null>(null);

  useEffect(() => {
    const pair = clients.current;
    const selectedKey = key.trim();
    if (!active || !pair || !selectedKey) return;
    Promise.all(pair.map((client) => client.subscribe([selectedKey]))).catch(() => {
      if (clients.current === pair)
        setError("Could not subscribe to this key. Reconnect and try again.");
    });
    return () => {
      pair.forEach((client) => {
        void client.unsubscribe([selectedKey]).catch(() => {});
      });
    };
  }, [active, key]);

  useEffect(
    () => () => {
      clients.current?.forEach((client) => client.destroy());
      clients.current = null;
    },
    [],
  );

  /** Read each client's own local cache; never copy values from one client to the other. */
  function refresh() {
    const pair = clients.current;
    if (!pair) return;
    setConnected(pair.map((client) => client.isConnected()));
    setSnapshots(
      pair.map((client) =>
        client
          .getAllKeys()
          .sort()
          .map((key) => ({
            key,
            value: client.getItem(key),
          })),
      ),
    );
  }

  /** Keep a bounded log of observed events, excluding credentials and payloads. */
  function record(client: string, message: string) {
    setEvents((items) =>
      [
        {
          id: crypto.randomUUID(),
          time: new Date().toLocaleTimeString(),
          client,
          message,
        },
        ...items,
      ].slice(0, 30),
    );
  }

  /** Report actionable errors without allowing rejected promises to escape UI handlers. */
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(apiKey ? message.replaceAll(apiKey, "[redacted]") : message);
    } finally {
      refresh();
      setBusy(false);
    }
  }

  /** Open two real connections with distinct instance IDs and cache namespaces. */
  async function connect() {
    await run(async () => {
      const url = new URL(serverUrl);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
        throw new Error("Use an HTTP(S) server URL without embedded credentials.");
      if (!apiKey.trim() || !userId.trim()) throw new Error("Enter an API key and user ID.");
      const pair = ["writer", "replica"].map(
        (name) =>
          new RemoteStorage({
            serverUrl: serverUrl.trim(),
            apiKey: apiKey.trim(),
            userId: userId.trim(),
            instanceId: tabId + "-" + name,
            namespace: "playground:" + url.origin + ":" + tabId + ":" + name,
            mode,
            autoConnect: false,
            timeout: 8000,
          }),
      ) as Pair;
      clients.current = pair;
      pair.forEach((client, index) => {
        const label = index === 0 ? "Client A" : "Client B";
        const update = () => {
          if (clients.current === pair) refresh();
        };
        client.on("change", (event: { source: string; key: string }) => {
          if (clients.current !== pair) return;
          record(label, `${event.source === "remote" ? "Received" : "Changed"} · ${event.key}`);
          update();
        });
        client.on("sync", update);
        client.on("connect", () => {
          if (clients.current === pair) {
            record(label, "Connected");
            update();
          }
        });
        client.on("disconnect", () => {
          if (clients.current === pair) {
            record(label, "Disconnected");
            update();
          }
        });
        client.on("error", () => {
          if (clients.current === pair) record(label, "Transport error — check connection");
        });
      });
      const results = await Promise.allSettled(pair.map((client) => client.connect()));
      if (clients.current !== pair) return;
      const failure = results.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") {
        pair.forEach((client) => client.destroy());
        clients.current = null;
        setConnected([false, false]);
        throw failure.reason;
      }
      setActive(true);
      setNotice("Both clients are ready. Save a value to see it arrive on Client B.");
    });
  }

  /** End the session while preserving SDK outboxes for the same identity on reconnect. */
  function endSession() {
    clients.current?.forEach((client) => client.destroy());
    clients.current = null;
    setActive(false);
    setConnected([false, false]);
    setSnapshots([[], []]);
    setNotice("Session closed. Pending writes remain in this browser's local outbox.");
    setError("");
  }

  /** Commit valid JSON, including false, zero, empty strings and null. */
  async function save() {
    await run(async () => {
      if (!key.trim()) throw new Error("A storage key is required.");
      let value: unknown;
      try {
        value = JSON.parse(draft);
      } catch {
        throw new Error("Invalid JSON. Quote strings and remove trailing commas.");
      }
      const writer = clients.current?.[0];
      if (!writer) return;
      await writer.setItem(key.trim(), value);
      setNotice(
        writer.isConnected()
          ? "Write acknowledged. Watch the replica receive it."
          : "Saved locally. Reconnect Client A to deliver this write.",
      );
    });
  }

  const replica = snapshots[1].find((item) => item.key === key.trim());
  const docsUrl = import.meta.env.VITE_DOCS_URL || "http://localhost:4000/docs";
  const matches =
    replica !== undefined &&
    JSON.stringify(replica.value) ===
      JSON.stringify(snapshots[0].find((item) => item.key === key.trim())?.value);

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Sync Store playground">
          <img src={logo} alt="" />
          <span>Sync Store</span>
          <span className="divider" />
          <span className="muted">Playground</span>
        </a>
        <nav aria-label="Project links">
          <a href={docsUrl} target="_blank" rel="noreferrer">
            Documentation ↗
          </a>
          <a href="https://github.com/ali-master/sync-store" target="_blank" rel="noreferrer">
            GitHub ↗
          </a>
        </nav>
      </header>
      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-label">WORKSPACE</div>
          <div className="selected-nav">
            <span>◈</span> Sync playground <span className="nav-dot" />
          </div>
          <form
            className="connection-form"
            onSubmit={(event) => {
              event.preventDefault();
              void connect();
            }}
          >
            <div className="section-heading">
              <h2>Connection</h2>
              <span className="micro">YOUR API</span>
            </div>
            <label>
              Server URL
              <input
                type="url"
                required
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                disabled={active || busy}
              />
            </label>
            <label>
              API key
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                required
                placeholder="Paste a development key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={active || busy}
              />
            </label>
            <label>
              User ID
              <input
                required
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                disabled={active || busy}
              />
            </label>
            <label>
              Transport
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as typeof mode)}
                disabled={active || busy}
              >
                <option value="websocket">WebSocket · real-time</option>
                <option value="http">HTTP · polling</option>
              </select>
            </label>
            {active ? (
              <button
                className="secondary full"
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  endSession();
                }}
                disabled={busy}
              >
                End session
              </button>
            ) : (
              <button className="primary full" disabled={busy}>
                {busy ? "Connecting…" : "Connect clients"} <span>↗</span>
              </button>
            )}
            <p className="small muted">
              Both clients share a user ID, but have independent connections and caches.
            </p>
          </form>
          <div className="security-note">
            <span className="micro">LOCAL DEVELOPMENT</span>
            <p>
              Use a disposable, write-enabled key. Credentials stay in memory. Never publish a
              shared production key in a browser.
            </p>
          </div>
          <a
            className="setup-link"
            href={docsUrl + "/getting-started"}
            target="_blank"
            rel="noreferrer"
          >
            Need an API? Setup guide ↗
          </a>
        </aside>
        <main>
          <div className="eyebrow">
            EXPLORE THE SDK <span>/</span> LIVE PLAYGROUND
          </div>
          <div className="page-heading">
            <div>
              <h1>One change. Everywhere.</h1>
              <p>Write on one client. Watch it arrive on another.</p>
            </div>
            <span className={"session-status " + (connected.every(Boolean) ? "online" : "")}>
              <i />
              {connected.every(Boolean)
                ? "Clients connected"
                : active
                  ? "Connection interrupted"
                  : "Ready when you are"}
            </span>
          </div>
          <div className="walkthrough">
            <div>
              <b>01</b>
              <span>Connect your API</span>
            </div>
            <span className="step-arrow">→</span>
            <div>
              <b>02</b>
              <span>Save a JSON value</span>
            </div>
            <span className="step-arrow">→</span>
            <div>
              <b>03</b>
              <span>Try going offline</span>
            </div>
          </div>
          {(error || notice) && (
            <div className={"message " + (error ? "error" : "")} role={error ? "alert" : "status"}>
              {error || notice}
            </div>
          )}
          <section className="sync-grid" aria-label="Independent storage clients">
            <article className="client-card">
              <div className="card-heading">
                <div className="client-name">
                  <span className="client-letter">A</span>
                  <div>
                    <h2>Source client</h2>
                    <p>Write & edit</p>
                  </div>
                </div>
                <span className={"status " + (connected[0] ? "online" : "")}>
                  <i />
                  {connected[0] ? "Connected" : active ? "Offline" : "Not connected"}
                </span>
              </div>
              <div className="editor-toolbar">
                <label htmlFor="storage-key">KEY</label>
                <input
                  id="storage-key"
                  aria-label="Storage key"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  disabled={busy}
                />
                <span>JSON</span>
              </div>
              <label className="sr-only" htmlFor="json-value">
                JSON value
              </label>
              <textarea
                id="json-value"
                className="code-editor"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
                aria-describedby="editor-help"
              />
              <div className="editor-help" id="editor-help">
                A draft until you save. Objects, arrays and JSON primitives are supported.
              </div>
              <div className="card-actions">
                <button className="primary" disabled={!active || busy} onClick={() => void save()}>
                  {busy && active ? "Working…" : connected[0] ? "Save & sync" : "Save locally"}{" "}
                  <span>↑</span>
                </button>
                <button
                  className="text-button"
                  disabled={!active || busy}
                  onClick={() =>
                    void run(async () => {
                      await clients.current?.[0].removeItem(key.trim());
                      setNotice(
                        "Deletion submitted. Offline deletions are delivered after reconnecting.",
                      );
                    })
                  }
                >
                  Delete key
                </button>
              </div>
              <div className="offline-control">
                <div>
                  <strong>Test offline writes</strong>
                  <p>Disconnect A. Edit. Save. Reconnect.</p>
                </div>
                <button
                  className="secondary"
                  disabled={!active || busy}
                  onClick={() =>
                    void run(async () => {
                      const writer = clients.current?.[0];
                      if (!writer) return;
                      if (writer.isConnected()) {
                        writer.disconnect();
                        setNotice("Client A is offline. You can still save changes locally.");
                      } else {
                        await writer.connect();
                        setNotice("Client A reconnected and reconciled with the server.");
                      }
                    })
                  }
                >
                  {connected[0] ? "Go offline" : "Reconnect"}
                </button>
              </div>
            </article>
            <article className="client-card replica">
              <div className="card-heading">
                <div className="client-name">
                  <span className="client-letter secondary-letter">B</span>
                  <div>
                    <h2>Remote replica</h2>
                    <p>Received from the server</p>
                  </div>
                </div>
                <span className={"status " + (connected[1] ? "online" : "")}>
                  <i />
                  {connected[1] ? "Connected" : "Not connected"}
                </span>
              </div>
              <div className="editor-toolbar">
                <span>KEY</span>
                <strong>{key.trim() || "—"}</strong>
                <span>READ ONLY</span>
              </div>
              {replica ? (
                <pre
                  className="code-editor replica-value"
                  aria-label="Replica value"
                  aria-live="polite"
                >
                  {JSON.stringify(replica.value, null, 2)}
                </pre>
              ) : (
                <div className="empty-replica">
                  <span className="empty-symbol">⇄</span>
                  <h3>{active ? "Waiting for a value" : "Your second point of view"}</h3>
                  <p>
                    {active
                      ? "Save a value on Client A. It will appear here after the server delivers it."
                      : "Connect to your API to see real changes travel between two independent clients."}
                  </p>
                </div>
              )}
              <div className="replica-footer">
                <span className={matches ? "match" : "muted"}>
                  {matches ? "✓ Values match" : "No matching value yet"}
                </span>
                <span>{mode === "http" ? "HTTP polling" : "WebSocket delivery"}</span>
              </div>
              <div className="keys-section">
                <div className="section-heading">
                  <strong>Stored keys</strong>
                  <span className="count">{snapshots[1].length}</span>
                </div>
                <div className="key-list">
                  {snapshots[1].length ? (
                    snapshots[1].map((item) => (
                      <button
                        key={item.key}
                        className={key === item.key ? "key active-key" : "key"}
                        onClick={() => {
                          setKey(item.key);
                          setDraft(JSON.stringify(item.value, null, 2));
                        }}
                      >
                        {item.key}
                      </button>
                    ))
                  ) : (
                    <span className="small muted">No keys received in this session.</span>
                  )}
                </div>
              </div>
            </article>
          </section>
          <section className="activity" aria-label="Live activity">
            <div className="activity-heading">
              <div>
                <h2>
                  Activity stream <span className="count">{events.length}</span>
                </h2>
                <p>Real client events. No simulated traffic.</p>
              </div>
              <button
                className="text-button"
                onClick={() => setEvents([])}
                disabled={!events.length}
              >
                Clear log
              </button>
            </div>
            {!events.length ? (
              <div className="empty-log">
                <span className="pulse-icon">⌁</span> Your connection and sync events will appear
                here.
              </div>
            ) : (
              <ol className="event-list">
                {events.map((event) => (
                  <li key={event.id}>
                    <time>{event.time}</time>
                    <span className="event-client">{event.client}</span>
                    <span>{event.message}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <footer className="workspace-footer">
            <span>
              <i className="blue-dot" /> Built with the real Sync Store SDK
            </span>
            <a href={docsUrl + "/guides/offline-sync"} target="_blank" rel="noreferrer">
              How synchronization works ↗
            </a>
          </footer>
        </main>
      </div>
    </div>
  );
}
