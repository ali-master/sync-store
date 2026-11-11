/**
 * Installation settings an administrator can change from the dashboard. Each one is named after the
 * environment variable it overrides: a value stored in the database wins, the environment is the
 * fallback, then the built-in default. Infrastructure settings that are needed to reach the
 * database (DATABASE_URL, REDIS_URL, secrets for sessions) stay environment-only.
 */
export type SettingType = "url" | "text" | "list" | "integer" | "secret";

export interface SettingDefinition {
  env: string;
  group: "General" | "Data" | "Single sign-on" | "Monitoring";
  label: string;
  description: string;
  type: SettingType;
  placeholder?: string;
  min?: number;
  max?: number;
}

export const SETTINGS: readonly SettingDefinition[] = [
  {
    env: "API_URL",
    group: "General",
    label: "Public API URL",
    description:
      "The address applications and assistants use to reach this installation, such as https://sync.example.com. It appears in SDK examples, the MCP and metrics addresses, and the default SSO redirect.",
    type: "url",
    placeholder: "https://sync.example.com",
  },
  {
    env: "CORS_ALLOWED_ORIGINS",
    group: "General",
    label: "Allowed browser origins",
    description:
      "Comma-separated exact origins whose pages may call the API, such as https://app.example.com. A single * allows every origin; API keys still authorize each request.",
    type: "list",
    placeholder: "https://app.example.com, https://docs.example.com",
  },
  {
    env: "HISTORY_RETENTION_DAYS",
    group: "Data",
    label: "History retention (days)",
    description:
      "How long newly captured versions of an item are kept. Existing versions keep the retention they were written with.",
    type: "integer",
    min: 1,
    max: 3650,
    placeholder: "30",
  },
  {
    env: "SSO_ISSUER",
    group: "Single sign-on",
    label: "Issuer URL",
    description:
      "The OpenID Connect issuer of your identity provider. Leave it empty to turn single sign-on off.",
    type: "url",
    placeholder: "https://accounts.google.com",
  },
  {
    env: "SSO_CLIENT_ID",
    group: "Single sign-on",
    label: "Client ID",
    description: "The client ID of the application you registered with the provider.",
    type: "text",
  },
  {
    env: "SSO_CLIENT_SECRET",
    group: "Single sign-on",
    label: "Client secret",
    description:
      "The client secret, if the provider issued one. It is never shown again after you save it.",
    type: "secret",
  },
  {
    env: "SSO_REDIRECT_URI",
    group: "Single sign-on",
    label: "Redirect URI",
    description:
      "Register exactly this address with the provider. Leave it empty to use the public API URL followed by /api/v1/sso/callback.",
    type: "url",
    placeholder: "https://sync.example.com/api/v1/sso/callback",
  },
  {
    env: "SSO_PROVIDER_NAME",
    group: "Single sign-on",
    label: "Button label",
    description: "Shown on the sign-in button as Continue with …",
    type: "text",
    max: 40,
    placeholder: "Google",
  },
  {
    env: "SSO_ALLOWED_EMAILS",
    group: "Single sign-on",
    label: "Allowed email addresses",
    description: "Comma-separated addresses that may sign in.",
    type: "list",
    placeholder: "owner@example.com",
  },
  {
    env: "SSO_ALLOWED_DOMAINS",
    group: "Single sign-on",
    label: "Allowed email domains",
    description: "Comma-separated domains that may sign in. Subdomains are not included.",
    type: "list",
    placeholder: "example.com",
  },
  {
    env: "SSO_SCOPES",
    group: "Single sign-on",
    label: "Scopes",
    description: "Scopes requested from the provider.",
    type: "text",
    placeholder: "openid email profile",
  },
  {
    env: "SSO_SESSION_MINUTES",
    group: "Single sign-on",
    label: "Session length (minutes)",
    description: "How long a console session from single sign-on lasts.",
    type: "integer",
    min: 1,
    max: 1440,
    placeholder: "480",
  },
  {
    env: "METRICS_TOKEN",
    group: "Monitoring",
    label: "Metrics token",
    description:
      "Bearer token Prometheus sends to /metrics. Without one, only an administrator API key can read the metrics.",
    type: "secret",
    min: 32,
  },
];

export const settingNames = new Set(SETTINGS.map((setting) => setting.env));

let overrides: Record<string, string> = {};

/** The value in effect: the database override, else the environment. Empty means unset. */
export function setting(name: string): string | undefined {
  const value = Object.hasOwn(overrides, name) ? overrides[name] : process.env[name];
  return value === "" ? undefined : value;
}

/** The environment as the application should see it, with database overrides applied. */
export function effectiveEnv(
  extra: Record<string, string> = {},
): Record<string, string | undefined> {
  return { ...process.env, ...overrides, ...extra };
}

export function currentOverrides(): Readonly<Record<string, string>> {
  return overrides;
}

/** Replace the cached overrides; called when the database copy is loaded or changes. */
export function applyOverrides(next: Record<string, string>) {
  overrides = Object.fromEntries(Object.entries(next).filter(([name]) => settingNames.has(name)));
}
