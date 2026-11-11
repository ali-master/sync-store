import { readFileSync } from "node:fs";
// Temporary: serves fake API responses so the dashboard can be viewed without MongoDB.
// Not part of the project. Run: bun --bun vite --config <this file> --port 4100
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";

const root = import.meta.dirname;
const now = Date.now();
const iso = (offset: number) => new Date(now - offset).toISOString();
const users = ["user_42", "user_7", "ada", "grace", "linus", "tenant:acme:user_1"];
const keys = ["preferences", "cart/items", "profile", "drafts/1", "flags", "session/last"];

const rows: Record<string, (i: number) => Record<string, unknown>> = {
  storage: (i) => ({
    _id: "itm_" + i,
    userId: users[i % users.length],
    key: keys[i % keys.length],
    value: JSON.stringify({ theme: i % 2 ? "dark" : "light", count: i }),
    version: 1 + (i % 9),
    size: 120 + i * 7,
    instanceId: "browser-" + (i % 4),
    createdAt: iso(i * 3_600_000),
    lastModified: iso(i * 1_800_000),
    isDeleted: false,
  }),
  keys: (i) => ({
    _id: i === 0 ? "sync-store-bootstrap-admin" : "key_" + i,
    name: i === 0 ? "Installation administrator" : ["Web app", "Mobile app", "Agent", "Reports"][i % 4],
    isActive: i % 5 !== 4,
    canRead: true,
    canWrite: i % 2 === 0,
    scopes: i === 0 ? '["admin","analytics:read"]' : "[]",
    totalCalls: 1200 * (i + 1),
    minuteQuota: i % 3 ? 600 : null,
    metadata: "{}",
    allowedMethods: '["GET","POST","PUT","PATCH","DELETE"]',
    createdAt: iso(i * 86_400_000),
    lastUsedAt: iso(i * 60_000),
  }),
  projects: (i) => ({ _id: "prj_" + i, name: ["Shop", "Mobile", "Internal"][i % 3], tenantId: null, createdAt: iso(i * 86_400_000) }),
  tenants: (i) => ({ _id: "tnt_" + i, name: ["Acme", "Globex"][i % 2], isActive: i % 2 === 0, createdAt: iso(i * 86_400_000) }),
  history: (i) => ({ _id: `itm_${i}:${i + 1}`, recordId: "itm_" + i, userId: users[i % users.length], key: keys[i % keys.length], value: '{"theme":"dark"}', version: i + 1, isDeleted: i % 7 === 6, lastModified: iso(i * 900_000), expiresAt: iso(-30 * 86_400_000) }),
  sessions: (i) => ({ _id: "sock_" + i, socketId: "sock_" + i, userId: users[i % users.length], instanceId: "browser-" + i, connectedAt: iso(i * 120_000), connectionType: "websocket", disconnectedAt: null }),
  conflicts: (i) => ({ _id: "cnf_" + i, itemId: "itm_" + i, userId: users[i % users.length], conflictType: ["version_mismatch", "concurrent_update", "schema_change"][i % 3], status: i % 2 ? "resolved" : "pending", originalValue: '{"a":1}', conflictingValue: '{"a":2}', resolutionStrategy: "last_write_wins", createdAt: iso(i * 5_400_000) }),
  audits: (i) => ({ _id: "aud_" + i, userId: "admin:sync-store-bootstrap-admin", instanceId: "dashboard", action: ["admin.key.create", "admin.storage.write", "admin.sso.login", "admin.key.rotate"][i % 4], metadata: JSON.stringify({ target: "key_" + i }), createdAt: iso(i * 2_700_000) }),
  quotas: (i) => ({ _id: "qta_" + i, userId: users[i % users.length], maxItems: 1000, maxStorageBytes: "10485760", requestsPerMinute: 120, createdAt: iso(i * 86_400_000) }),
  analytics: (i) => ({ _id: "anl_" + i, userId: users[i % users.length], action: "set", createdAt: iso(i * 600_000) }),
  archives: (i) => ({ _id: "arc_" + i, userId: users[i % users.length], key: keys[i % keys.length], createdAt: iso(i * 86_400_000 * 3) }),
};
const totals: Record<string, number> = { storage: 1284, keys: 7, projects: 3, tenants: 2, history: 5321, sessions: 18, conflicts: 12, audits: 240, quotas: 6, analytics: 90, archives: 0 };

function report(kind: string, hours: number) {
  // The API uses minute buckets up to 24 hours and hourly buckets beyond, as reportRange does.
  const step = hours <= 24 ? 60_000 : 3_600_000;
  const end = now, start = end - hours * 3_600_000;
  const series = [];
  for (let t = start - hours * 3_600_000; t < end; t += step) {
    const wave = Math.sin(t / 3.6e6) * 0.5 + 1;
    if (Math.floor(t / step) % 17 === 3) continue; // a gap
    const n = (base: number) => Math.round(base * wave + (t % 7));
    series.push({ time: new Date(t).toISOString(), published: n(120), publishFailures: n(1), connections: n(9), disconnections: n(8), p95UpperMs: [10, 50, 100, 250][Math.floor(t / step) % 4], pending: n(2), oldestAgeMs: n(400), httpRequests: n(300), httpErrors: n(4), http429: n(1), admitted: n(280), reads: n(200), writes: n(80), quotaRejections: n(1), created: n(20), updated: n(55), deleted: n(6), restored: n(1), bytes: 5_000_000 + n(40_000) });
  }
  const base = { start: new Date(start).toISOString(), end: new Date(end).toISOString(), hours, step, series, retentionDays: 90, generatedAt: new Date().toISOString() };
  // Shapes follow OperationsService.health / usage / changes.
  if (kind === "health")
    return { ...base, replicas: ["api-1", "api-2"], snapshots: series.map((row) => ({ time: row.time, pending: row.pending, oldestAgeMs: row.oldestAgeMs })) };
  if (kind === "usage")
    return {
      ...base,
      topKeys: ["key_1", "key_2", "key_3"].map((id, i) => ({ _id: id, admitted: 9000 - i * 2500, httpRequests: 9500 - i * 2500, quotaRejections: i * 3 })),
      quotas: ["minute", "hour", "day", "month"].map((window, i) => ({ apiKeyId: "key_1", name: "Web app", project: "default", window, used: 40 * (i + 1) ** 3, limit: i === 3 ? null : 600 * (i + 1) ** 3, percent: i === 3 ? null : 100 / 15, resetsAt: new Date(now + 60_000 * 60 ** i).toISOString(), estimatedExhaustionAt: null })),
    };
  return {
    ...base,
    growth: series.map((row, i) => ({ time: row.time, items: 1200 + i * 2, valueBytes: 4_000_000 + i * 9000, historyBytes: 9_000_000 + i * 20_000, historyVersions: 5000 + i * 8 })),
    topKeys: ["preferences", "cart/items", "profile"].map((key, i) => ({ _id: { key, project: "default" }, changes: 400 - i * 120 })),
  };
}

let setupRequired = false;
let mockRevision = 3;
const def = (env: string, group: string, label: string, type: string, extra: Record<string, unknown> = {}) => ({
  env, group, label, type, description: "Mock description of " + label + ".", source: "default", set: false, value: null,
  environmentValue: null, environmentSet: false, defaultValue: null, ...extra,
});
const mockSettings: any[] = [
  def("API_URL", "General", "Public API URL", "url", { source: "database", value: "https://sync.example.com", set: true, environmentValue: "http://localhost:3000", environmentSet: true }),
  def("CORS_ALLOWED_ORIGINS", "General", "Allowed browser origins", "list", { source: "environment", value: "*", set: true, environmentValue: "*", environmentSet: true }),
  def("HISTORY_RETENTION_DAYS", "Data", "History retention (days)", "integer", { min: 1, max: 3650, value: "30", defaultValue: "30" }),
  def("SSO_ISSUER", "Single sign-on", "Issuer URL", "url", { source: "database", value: "https://accounts.google.com", set: true }),
  def("SSO_CLIENT_ID", "Single sign-on", "Client ID", "text", { source: "database", value: "1234-abc.apps.googleusercontent.com", set: true }),
  def("SSO_CLIENT_SECRET", "Single sign-on", "Client secret", "secret", { source: "database", set: true }),
  def("SSO_REDIRECT_URI", "Single sign-on", "Redirect URI", "url"),
  def("SSO_PROVIDER_NAME", "Single sign-on", "Button label", "text", { max: 40, value: "SSO", defaultValue: "SSO" }),
  def("SSO_ALLOWED_EMAILS", "Single sign-on", "Allowed email addresses", "list"),
  def("SSO_ALLOWED_DOMAINS", "Single sign-on", "Allowed email domains", "list", { source: "database", value: "example.com", set: true }),
  def("SSO_SCOPES", "Single sign-on", "Scopes", "text", { value: "openid email profile", defaultValue: "openid email profile" }),
  def("SSO_SESSION_MINUTES", "Single sign-on", "Session length (minutes)", "integer", { min: 1, max: 1440, value: "480", defaultValue: "480" }),
  def("METRICS_TOKEN", "Monitoring", "Metrics token", "secret", { min: 32 }),
];
const mockApi = (): Plugin => ({
  name: "mock-api",
  enforce: "pre",
  // Start signed in, unless MOCK_SIGNED_OUT=1: the real session lives in memory and a reload loses it.
  transform(code, id) {
    if (!process.env.MOCK_SIGNED_OUT && id.endsWith("/src/lib/session.tsx"))
      return code.replace('const [token, setToken] = useState("");', 'const [token, setToken] = useState("mock-admin-key");');
  },
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = new URL(req.url ?? "/", "http://x");
      if (!url.pathname.startsWith("/api/v1/")) return next();
      const path = url.pathname.slice("/api/v1/".length);
      const send = (payload: unknown, status = 200) => {
        res.statusCode = status;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(status < 400 ? { payload } : payload));
      };
      if (path === "__mock") {
        setupRequired = url.searchParams.get("setup") === "1";
        return send({ setupRequired });
      }
      if (path === "setup" && req.method === "POST") return send({ key: "ss_admin_" + "a1b2c3d4".repeat(8) });
      if (path === "setup") return send({ required: setupRequired });
      if (path === "sso") return send({ enabled: true, name: "Google" });
      if (path === "sso/session") return send({ message: "No SSO sign-in is waiting. Sign in again." }, 401);
      if (!path.startsWith("admin/")) return send({ message: "Not mocked: " + path }, 404);
      if (!req.headers.authorization) return send({ message: "An administrator Bearer key is required" }, 401);
      const admin = path.slice("admin/".length);
      if (admin === "about") {
        const pkg = JSON.parse(readFileSync(root + "/../api/package.json", "utf8"));
        const origin = "https://sync.example.com";
        return send({
          name: pkg.name, description: pkg.description, version: pkg.version, license: pkg.license,
          author: pkg.author, contributors: [], repositoryUrl: String(pkg.repository?.url ?? "").replace(/^git\+/, "").replace(/\.git$/, ""),
          issuesUrl: pkg.bugs?.url ?? null, docsUrl: pkg.homepage ?? null, keywords: pkg.keywords ?? [],
          runtime: { bun: "1.4.4", node: "24.3.0" }, publicUrl: origin,
          endpoints: { api: origin + "/api/v1", openapi: origin + "/api/docs", mcp: origin + "/mcp", metrics: origin + "/metrics", dashboard: origin + "/dashboard/" },
        });
      }
      if (admin === "settings") {
        if (req.method === "PATCH") {
          let body = "";
          req.on("data", (chunk) => (body += chunk));
          req.on("end", () => {
            const { values } = JSON.parse(body || "{}");
            for (const [env, value] of Object.entries(values ?? {})) {
              const item = mockSettings.find((s) => s.env === env);
              if (!item) continue;
              if (value === null) Object.assign(item, { source: item.environmentSet ? "environment" : "default", value: item.type === "secret" ? null : item.environmentValue ?? item.defaultValue, set: item.environmentSet });
              else Object.assign(item, { source: "database", value: item.type === "secret" ? null : value, set: value !== "" });
            }
            mockRevision++;
            send({ revision: mockRevision, updatedAt: new Date().toISOString(), updatedBy: "sync-store-bootstrap-admin", settings: mockSettings });
          });
          return;
        }
        return send({ revision: mockRevision, updatedAt: new Date().toISOString(), updatedBy: "sync-store-bootstrap-admin", settings: mockSettings });
      }
      if (admin === "overview")
        return send({ tenantId: null, counts: totals, users: 412, activeSessions: 18, storageBytes: 48_392_112, totalCalls: 982_113, databaseLatencyMs: 3, uptimeSeconds: 93_784, database: "sync_store", runtime: "Bun", timestamp: new Date().toISOString() });
      if (admin.startsWith("resources/")) {
        const resource = admin.slice("resources/".length);
        const page = Number(url.searchParams.get("page") || 1);
        const total = totals[resource] ?? 0;
        const count = Math.max(0, Math.min(25, total - (page - 1) * 25));
        return send({ items: Array.from({ length: count }, (_, i) => (rows[resource] ?? rows.audits)(i + (page - 1) * 25)), total, page, pageSize: 25 });
      }
      if (admin.startsWith("reports/saved")) return send([]);
      if (admin.startsWith("reports/")) return send(report(admin.slice(8), Number(url.searchParams.get("hours") || 24)));
      if (admin.startsWith("versioning"))
        return send({ branches: [{ name: "main", head: "c3" }, { name: "drafts", head: "c2" }], commits: [3, 2, 1].map((n) => ({ id: "c" + n, branch: "main", parent: n > 1 ? "c" + (n - 1) : null, message: ["Initial import", "Before pricing change", "Weekly checkpoint"][n - 1], createdAt: iso(n * 86_400_000), projected: true })), timeline: [3, 2, 1].map((n) => ({ _id: "c" + n, at: iso(n * 86_400_000), parent: n > 1 ? "c" + (n - 1) : null, message: "Commit " + n })) });
      return send({ message: "Not mocked: " + admin }, 404);
    });
  },
});

export default defineConfig({
  root,
  plugins: [react(), tailwindcss(), mockApi()],
  resolve: { alias: { "@": root + "/src" } },
  base: "/dashboard/",
});
