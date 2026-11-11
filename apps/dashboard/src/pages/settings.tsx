import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, RotateCcw, Save, Sparkles, Trash2 } from "lucide-react";
import { Alert, AlertContent, AlertDescription, AlertTitle } from "@/components/motion/alert";
import { AnimatedBadge } from "@/components/motion/animated-badge";
import { Button } from "@/components/motion/button/base";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/motion/card";
import { Input } from "@/components/motion/input";
import { Loader } from "@/components/motion/loader";
import { useConsole } from "@/lib/console-actions";
import { useSession } from "@/lib/session";

type Source = "database" | "environment" | "default";
type Setting = {
  env: string;
  group: string;
  label: string;
  description: string;
  type: "url" | "text" | "list" | "integer" | "secret";
  placeholder?: string;
  min?: number;
  max?: number;
  source: Source;
  set: boolean;
  value: string | null;
  environmentValue: string | null;
  environmentSet: boolean;
  defaultValue: string | null;
};
type View = {
  revision: number;
  updatedAt: string | null;
  updatedBy: string | null;
  settings: Setting[];
};
/** A pending change: a string to store, or null to fall back to the environment. */
type Draft = Record<string, string | null>;

const sourceBadge: Record<Source, { label: string; status: "success" | "info" | "neutral" }> = {
  database: { label: "Saved in database", status: "success" },
  environment: { label: "From environment", status: "info" },
  default: { label: "Default", status: "neutral" },
};

const groupNotes: Record<string, string> = {
  General: "How applications, assistants and browsers reach this installation.",
  Data: "Retention of what the API keeps.",
  "Single sign-on":
    "Let your team sign in with your identity provider. The administrator key keeps working.",
  Monitoring: "Access to the Prometheus endpoint at /metrics.",
};

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function SettingField({
  setting,
  draft,
  onChange,
  busy,
}: {
  setting: Setting;
  draft: string | null | undefined;
  onChange: (value: string | null | undefined) => void;
  busy: boolean;
}) {
  const secret = setting.type === "secret";
  const changed = draft !== undefined;
  const shown = changed ? (draft ?? setting.environmentValue ?? "") : (setting.value ?? "");
  const badge = sourceBadge[setting.source];
  return (
    <div className="grid gap-3 border-t pt-5 first:border-t-0 first:pt-0 md:grid-cols-[minmax(0,15rem)_1fr]">
      <div className="space-y-1.5">
        <p className="text-sm font-medium">{setting.label}</p>
        <p className="font-mono text-[11px] text-muted-foreground">{setting.env}</p>
        <div className="flex flex-wrap gap-1.5">
          {changed ? (
            <AnimatedBadge size="sm" status="warning" showIcon={false}>
              {draft === null ? "Will use environment" : "Unsaved"}
            </AnimatedBadge>
          ) : (
            <AnimatedBadge size="sm" status={badge.status} showIcon={false}>
              {badge.label}
            </AnimatedBadge>
          )}
          {secret && !changed && (
            <AnimatedBadge size="sm" status={setting.set ? "success" : "neutral"} showIcon={false}>
              {setting.set ? "Set" : "Not set"}
            </AnimatedBadge>
          )}
        </div>
      </div>
      <div className="min-w-0 space-y-2">
        <Input
          aria-label={setting.label}
          type={secret ? "password" : setting.type === "integer" ? "number" : "text"}
          autoComplete="off"
          spellCheck={false}
          inputMode={setting.type === "integer" ? "numeric" : undefined}
          min={setting.min}
          max={setting.max}
          disabled={busy}
          value={secret ? (changed ? (draft ?? "") : "") : shown}
          placeholder={
            secret
              ? setting.set
                ? "Saved. Type a new value to replace it."
                : "Not set"
              : (setting.placeholder ?? setting.defaultValue ?? "")
          }
          leftIcon={secret ? <KeyRound /> : undefined}
          onChange={(value) => onChange(value)}
          classNames={{ input: setting.type === "text" ? "text-sm" : "font-mono text-xs" }}
        />
        <p className="text-xs leading-5 text-muted-foreground">{setting.description}</p>
        {!secret && setting.source === "database" && setting.environmentSet && !changed && (
          <p className="text-xs text-muted-foreground">
            Environment value:{" "}
            <code className="rounded bg-muted px-1 font-mono">{setting.environmentValue}</code>
          </p>
        )}
        {changed && draft && secret && setting.env === "METRICS_TOKEN" && (
          <Alert variant="warning" role="status">
            <AlertContent>
              <AlertTitle>Copy this token now</AlertTitle>
              <AlertDescription className="space-y-2">
                <span className="block">
                  Put it in your Prometheus scrape configuration. It is not shown again after you
                  save.
                </span>
                <span className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 break-all rounded-lg bg-foreground px-2 py-1.5 font-mono text-[11px] text-background">
                    {draft}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void navigator.clipboard.writeText(draft)}
                  >
                    <Copy className="size-3.5" />
                    Copy
                  </Button>
                </span>
              </AlertDescription>
            </AlertContent>
          </Alert>
        )}
        <div className="flex flex-wrap gap-2">
          {setting.env === "METRICS_TOKEN" && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onChange(randomToken())}
            >
              <Sparkles className="size-3.5" />
              Generate token
            </Button>
          )}
          {changed && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => onChange(undefined)}>
              Undo
            </Button>
          )}
          {!changed && setting.source === "database" && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => onChange(null)}>
              <RotateCcw className="size-3.5" />
              {setting.environmentSet ? "Use environment value" : "Use default"}
            </Button>
          )}
          {!changed && secret && setting.set && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive"
              disabled={busy}
              onClick={() => onChange("")}
            >
              <Trash2 className="size-3.5" />
              Remove
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Edit database-backed installation settings; secrets are write-only. */
export function SettingsPage({ platform }: { platform: boolean }) {
  const { request, run, busy, setNotice } = useConsole();
  const { sessionId } = useSession();
  const client = useQueryClient();
  const key = ["console", sessionId, "settings"];
  const query = useQuery<View>({
    queryKey: key,
    queryFn: ({ signal }) => request("settings", "GET", undefined, undefined, signal),
    enabled: platform,
  });
  const [draft, setDraft] = useState<Draft>({});
  const groups = useMemo(() => {
    const result = new Map<string, Setting[]>();
    for (const setting of query.data?.settings ?? [])
      result.set(setting.group, [...(result.get(setting.group) ?? []), setting]);
    return [...result];
  }, [query.data]);
  const pending = Object.keys(draft).length;

  if (!platform)
    return (
      <Alert variant="info" role="status">
        <AlertContent>
          <AlertTitle>Platform administrator required</AlertTitle>
          <AlertDescription>
            Installation settings apply to every tenant. Sign in with the installation administrator
            key or single sign-on to change them.
          </AlertDescription>
        </AlertContent>
      </Alert>
    );
  if (query.isPending)
    return (
      <div role="status" className="flex items-center gap-3 text-sm text-muted-foreground">
        <Loader size={16} /> Loading settings…
      </div>
    );
  if (query.isError)
    return (
      <Alert variant="destructive" role="alert">
        <AlertContent>
          <AlertTitle>Settings could not be loaded</AlertTitle>
          <AlertDescription>{query.error.message}</AlertDescription>
        </AlertContent>
      </Alert>
    );

  function change(env: string, value: string | null | undefined) {
    setDraft((current) => {
      const next = { ...current };
      if (value === undefined) delete next[env];
      else next[env] = value;
      return next;
    });
  }

  function save() {
    void run(async () => {
      const result: View = await request("settings", "PATCH", {
        values: draft,
        revision: query.data!.revision,
      });
      client.setQueryData(key, result);
      setDraft({});
      setNotice(
        `Saved ${pending} setting${pending === 1 ? "" : "s"}. Other replicas apply them within seconds.`,
      );
    });
  }

  return (
    <div className="space-y-6 pb-20">
      {groups.map(([group, settings]) => (
        <Card key={group}>
          <CardHeader>
            <CardTitle as="h2">{group}</CardTitle>
            <CardDescription>{groupNotes[group]}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {settings.map((setting) => (
              <SettingField
                key={setting.env}
                setting={setting}
                draft={draft[setting.env]}
                busy={busy}
                onChange={(value) => change(setting.env, value)}
              />
            ))}
          </CardContent>
        </Card>
      ))}
      <p className="text-xs leading-5 text-muted-foreground">
        Database URL, Redis, session secrets and the listening port stay in the environment: the API
        needs them before it can read this page's values.
        {query.data.updatedAt &&
          ` Last saved ${new Date(query.data.updatedAt).toLocaleString()}, revision ${query.data.revision}.`}
      </p>
      {pending > 0 && (
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card/95 p-3 pl-5 shadow-lg backdrop-blur">
          <span className="text-sm">
            {pending} unsaved change{pending === 1 ? "" : "s"}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => setDraft({})}>
              Discard
            </Button>
            <Button variant="primary" disabled={busy} onClick={save}>
              <Save className="size-4" />
              {busy ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
