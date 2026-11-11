export type Row = Record<string, any>;
export type Page = { items: Row[]; total: number; page: number; pageSize: number };
export const sections = [
  ["connect", "Connect your app", "↗"],
  ["health", "Sync health", "◉"],
  ["usage", "Usage & quotas", "◴"],
  ["changes", "Changes & growth", "↗"],
  ["overview", "Overview", "◈"],
  ["storage", "Data explorer", "▤"],
  ["keys", "API keys", "⌘"],
  ["tenants", "Tenants", "◎"],
  ["versioning", "Branches & commits", "⑂"],
  ["projects", "Projects", "◫"],
  ["history", "Version history", "↶"],
  ["sessions", "Connections", "⇄"],
  ["conflicts", "Conflicts", "⑂"],
  ["quotas", "User quotas", "◴"],
  ["audits", "Activity log", "≋"],
  ["analytics", "Analytics records", "▥"],
  ["archives", "Archives", "▣"],
  ["system", "System", "⚙"],
];
export const descriptions: Record<string, string> = {
  connect:
    "From your first credential to a verified change on another client. Follow each step with your own backend.",
  tenants:
    "Separate customer workspaces, each with its own administrator, projects, data and reports.",
  versioning: "Branch your data, inspect immutable commits and restore a complete snapshot safely.",
  changes:
    "Track data changes, retained history and storage growth. Save report views and export CSV.",
  usage: "Request trends, top consumers and live quota forecasts for each project and API key.",
  health: "Publication latency, pending events and connection trends across your replicas.",
  history:
    "Review retained versions and recover deleted data. Every restore creates a new synchronized change.",
  projects:
    "Isolated application namespaces. Bind API keys to a project to keep its data separate.",
  overview: "Your installation, at a glance. Real data from your connected backend.",
  storage: "Inspect and edit JSON across users. Changes use the live synchronization pipeline.",
  keys: "Issue application credentials and control their access. Secrets are shown only on creation or rotation.",
  sessions:
    "Inspect live Socket.IO connections across replicas and disconnect sessions. Clients may reconnect.",
  conflicts:
    "Review competing values and record a resolution proposal. Applying the value is a separate storage write.",
  quotas:
    "Stored per-user quota configuration. Enforcement depends on the backend path; these are not all active limits.",
  audits: "Recorded storage and administrator actions. This is not a complete HTTP request log.",
  analytics: "Persisted analytics records. No generated traffic or estimated historical metrics.",
  archives:
    "Inspect archived records. Archive restore and retention automation are not implemented.",
  system: "Connection health, runtime information and current operational boundaries.",
};
export const columns: Record<string, string[]> = {
  tenants: ["name", "_id", "isActive", "createdAt"],
  history: ["key", "userId", "version", "isDeleted", "lastModified", "expiresAt"],
  projects: ["name", "_id", "createdAt"],
  storage: ["key", "userId", "version", "size", "lastModified"],
  keys: ["name", "isActive", "canWrite", "totalCalls", "lastUsedAt"],
  sessions: ["userId", "instanceId", "connectionType", "connectedAt", "disconnectedAt"],
  conflicts: ["userId", "conflictType", "status", "resolutionStrategy", "createdAt"],
  quotas: ["userId", "currentItems", "maxItems", "currentStorageBytes", "maxStorageBytes"],
  audits: ["action", "userId", "instanceId", "createdAt"],
  analytics: ["userId", "metricType", "period", "createdAt"],
  archives: ["key", "userId", "originalSize", "archivedAt"],
};
export const labels: Record<string, string> = {
  key: "Storage key",
  userId: "User",
  instanceId: "Instance",
  isActive: "Active",
  canWrite: "Write",
  totalCalls: "Requests",
  lastUsedAt: "Last used",
  lastModified: "Modified",
  connectedAt: "Connected",
  disconnectedAt: "Disconnected",
  currentStorageBytes: "Used bytes",
  maxStorageBytes: "Storage limit",
  createdAt: "Created",
  _id: "Record ID",
};
export const quotaFields = [
  "maxStorageBytes",
  "maxItems",
  "requestsPerMinute",
  "requestsPerHour",
  "requestsPerDay",
  "maxInstancesPerUser",
  "maxConflictsPerHour",
  "maxAuditRetentionDays",
];
export const policyFields = [
  "minuteQuota",
  "hourQuota",
  "dailyQuota",
  "monthlyQuota",
  "ipRestrictions",
  "websiteOrigins",
  "restrictionMode",
  "allowedMethods",
  "allowedUserAgents",
  "blockedUserAgents",
  "requireHttps",
  "expiresAt",
];
export const bootstrapId = "sync-store-bootstrap-admin";

/** Show structured values without losing false, zero or large integer strings. */
export function display(value: any): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value))
    return new Date(value).toLocaleString();
  return String(value);
}

/** Stored sizes in the unit a person reads at a glance; exact bytes stay in the record. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    units.length - 1,
    bytes < 1 ? 0 : Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / 1024 ** index;
  return (
    (index === 0 ? String(Math.round(value)) : value.toFixed(value < 10 ? 2 : 1)) +
    " " +
    units[index]
  );
}

/** Uptime as its two largest units, such as "1 d 2 h" or "14 min". */
export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + " min";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + " h " + (minutes % 60) + " min";
  return Math.floor(hours / 24) + " d " + (hours % 24) + " h";
}
