import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Bug, Check, Copy, ExternalLink, GitFork, UserRound } from "lucide-react";
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
import { Loader } from "@/components/motion/loader";
import { useConsole } from "@/lib/console-actions";
import { useSession } from "@/lib/session";

type Person = { name?: string; email?: string; url?: string };
type About = {
  name: string | null;
  description: string | null;
  version: string | null;
  license: string | null;
  author: Person | null;
  contributors: Person[];
  repositoryUrl: string | null;
  issuesUrl: string | null;
  docsUrl: string | null;
  keywords: string[];
  runtime: { bun: string | null; node: string };
  publicUrl: string | null;
  endpoints: Record<string, string> | null;
};

/** "https://github.com/ali-master" reads as "github.com/ali-master". */
function display(url: string) {
  return url.replace(/^https?:\/\//, "");
}

function initials(name?: string) {
  return (name ?? "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function LinkRow({
  icon: Icon,
  label,
  href,
}: {
  icon: typeof BookOpen;
  label: string;
  href: string | null;
}) {
  return (
    <li className="flex items-center gap-3 py-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="block truncate text-xs text-primary underline-offset-4 hover:underline"
          >
            {display(href)}
          </a>
        ) : (
          <p className="text-xs text-muted-foreground">Not set in package.json</p>
        )}
      </div>
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          aria-label={"Open " + label}
          className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ExternalLink className="size-4" />
        </a>
      )}
    </li>
  );
}

function Endpoint({ name, url }: { name: string; url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-3 py-2.5">
      <span className="w-24 shrink-0 text-xs font-medium text-muted-foreground">{name}</span>
      <code className="min-w-0 flex-1 truncate font-mono text-xs">{url}</code>
      <Button
        variant="ghost"
        size="icon"
        aria-label={"Copy " + name + " address"}
        onClick={() =>
          void navigator.clipboard.writeText(url).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
        }
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </Button>
    </div>
  );
}

const endpointNames: Record<string, string> = {
  api: "REST API",
  openapi: "API reference",
  mcp: "MCP server",
  metrics: "Prometheus",
  dashboard: "Dashboard",
};

/** Project information read from the API's package.json on every visit, so edits show up at once. */
export function AboutPage() {
  const { request } = useConsole();
  const { sessionId } = useSession();
  const query = useQuery<About>({
    queryKey: ["console", sessionId, "about"],
    queryFn: ({ signal }) => request("about", "GET", undefined, undefined, signal),
  });
  if (query.isPending)
    return (
      <div role="status" className="flex items-center gap-3 text-sm text-muted-foreground">
        <Loader size={16} /> Reading package.json…
      </div>
    );
  if (query.isError)
    return (
      <Alert variant="destructive" role="alert">
        <AlertContent>
          <AlertTitle>Project information could not be loaded</AlertTitle>
          <AlertDescription>{query.error.message}</AlertDescription>
        </AlertContent>
      </Alert>
    );
  const about = query.data;
  const author = about.author;

  return (
    <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
      <Card className="xl:row-span-2">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle as="h2" className="text-xl">
              {about.name ?? "Sync Store"}
            </CardTitle>
            {about.version && (
              <AnimatedBadge size="sm" status="info" showIcon={false}>
                v{about.version}
              </AnimatedBadge>
            )}
            {about.license && (
              <AnimatedBadge size="sm" status="neutral" showIcon={false}>
                {about.license}
              </AnimatedBadge>
            )}
          </div>
          {about.description && <CardDescription>{about.description}</CardDescription>}
        </CardHeader>
        <CardContent className="space-y-6">
          {author && (
            <div className="flex items-center gap-4 rounded-2xl border bg-muted/40 p-4">
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary text-sm font-semibold text-primary-foreground">
                {author.name ? initials(author.name) : <UserRound className="size-5" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">Author</p>
                <p className="truncate font-medium">{author.name ?? "Unknown"}</p>
                {author.url && (
                  <a
                    href={author.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-xs text-primary underline-offset-4 hover:underline"
                  >
                    {display(author.url)}
                  </a>
                )}
              </div>
              {author.url && (
                <a
                  href={author.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-9 items-center gap-2 rounded-xl border bg-card px-3 text-xs font-medium transition-colors hover:bg-muted"
                >
                  <UserRound className="size-3.5" />
                  Profile
                </a>
              )}
            </div>
          )}
          <ul className="divide-y">
            <LinkRow icon={GitFork} label="Source code" href={about.repositoryUrl} />
            <LinkRow icon={BookOpen} label="Documentation" href={about.docsUrl} />
            <LinkRow icon={Bug} label="Report an issue" href={about.issuesUrl} />
          </ul>
          {about.contributors.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Contributors</p>
              <div className="flex flex-wrap gap-2">
                {about.contributors.map((person, index) => (
                  <AnimatedBadge key={index} size="sm" status="neutral" showIcon={false}>
                    {person.name ?? person.email ?? person.url}
                  </AnimatedBadge>
                ))}
              </div>
            </div>
          )}
          <p className="text-xs leading-5 text-muted-foreground">
            Read from <code className="rounded bg-muted px-1 font-mono">apps/api/package.json</code>{" "}
            each time this page opens: edit its <code className="font-mono">author</code>,{" "}
            <code className="font-mono">repository</code>,{" "}
            <code className="font-mono">homepage</code> or <code className="font-mono">bugs</code>{" "}
            fields and the dashboard follows without a rebuild.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">This installation</CardTitle>
          <CardDescription>
            Addresses built from the Public API URL setting
            {about.publicUrl ? ": " + about.publicUrl : "."}
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {about.endpoints ? (
            Object.entries(about.endpoints).map(([id, url]) => (
              <Endpoint key={id} name={endpointNames[id] ?? id} url={url} />
            ))
          ) : (
            <p className="text-sm text-muted-foreground">Set a Public API URL in Settings.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Runtime</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 text-sm [&_dd]:mt-1 [&_dd]:font-mono [&_dd]:text-xs [&_dt]:text-xs [&_dt]:text-muted-foreground">
            <div>
              <dt>Bun</dt>
              <dd>{about.runtime.bun ?? "—"}</dd>
            </div>
            <div>
              <dt>Node.js compatibility</dt>
              <dd>{about.runtime.node}</dd>
            </div>
          </dl>
          {about.keywords.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {about.keywords.map((keyword) => (
                <AnimatedBadge key={keyword} size="sm" status="neutral" showIcon={false}>
                  {keyword}
                </AnimatedBadge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
