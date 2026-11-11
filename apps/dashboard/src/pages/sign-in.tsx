import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ThemePicker } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConsole } from "@/lib/console-actions";
import { useSession } from "@/lib/session";
import { readSsoReturn, ssoRequest } from "@/lib/sso";
import logo from "../../../../assets/logo.svg";

/** Open the console with the administrator key or an organization account. */
export function SignIn({ error }: { error: string }) {
  const { token, setToken } = useSession();
  const { request, run, busy } = useConsole();
  const [credential, setCredential] = useState("");
  const [ssoError, setSsoError] = useState("");
  const sso = useQuery<{ enabled: boolean; name: string }>({
    queryKey: ["sso-status"],
    queryFn: () => ssoRequest(),
    enabled: !token,
  });
  /** After the identity provider redirects back, collect the session once and clean the URL. */
  useEffect(() => {
    const returned = readSsoReturn(location.hash);
    if (!returned.collect && !returned.error) return;
    history.replaceState(history.state, "", location.pathname + location.search);
    setSsoError(returned.error);
    if (returned.collect)
      ssoRequest("/session", "POST").then(
        (session) => setToken(session.token),
        (failure) => setSsoError(failure.message),
      );
  }, []);

  return (
    <main className="mx-auto grid min-h-screen max-w-6xl items-center gap-12 px-6 py-12 lg:grid-cols-[1.2fr_1fr] lg:gap-24">
      <div className="absolute right-4 top-4 z-10">
        <ThemePicker />
      </div>
      <div className="space-y-7 [&>img]:size-14 [&_h1]:text-5xl [&_h1]:font-semibold [&_h1]:leading-[1.12] [&_h1]:tracking-tight [&_h1_span]:text-muted-foreground [&>p:not(:first-of-type)]:max-w-md [&>p:not(:first-of-type)]:leading-7 [&>p:not(:first-of-type)]:text-muted-foreground">
        <img src={logo} alt="Sync Store" />
        <p className="text-[10px] font-semibold tracking-[0.24em] text-muted-foreground">
          SYNC STORE CONSOLE
        </p>
        <h1>
          Everything connected.
          <br />
          <span>Everything in view.</span>
        </h1>
        <p>A quiet place to manage your data, credentials and connections.</p>
        <div className="flex flex-wrap items-center gap-4 pt-7 text-xs [&_strong]:rounded-xl [&_strong]:border [&_strong]:bg-card [&_strong]:p-4 [&_i]:text-muted-foreground">
          <span>Application</span>
          <i>⇄</i>
          <strong>Sync Store</strong>
          <i>⇄</i>
          <span>Your users</span>
        </div>
      </div>
      <form
        className="space-y-6 rounded-2xl border bg-card p-7 shadow-sm sm:p-9 [&_h2]:text-3xl [&_h2]:font-semibold [&_h2]:tracking-tight [&>p]:text-sm [&>p]:leading-6 [&>p]:text-muted-foreground [&_label]:flex-col [&_label]:items-start [&_label]:gap-2 [&>button]:w-full [&>a]:block [&>a]:text-center [&>a]:text-xs [&>a]:text-primary"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await request("overview", "GET", undefined, credential.trim());
            setToken(credential.trim());
            setCredential("");
          });
        }}
      >
        <span className="text-[10px] font-semibold tracking-[0.2em] text-muted-foreground">
          YOUR INSTALLATION
        </span>
        <h2>Welcome back.</h2>
        {sso.data?.enabled ? (
          <>
            <p>Sign in with your organization account, or use the administrator key.</p>
            <Button
              type="button"
              variant="default"
              onClick={() => location.assign("/api/v1/sso/login")}
            >
              Continue with {sso.data.name} →
            </Button>
            <span className="block border-t pt-6 text-xs text-muted-foreground">
              Or connect with the administrator key
            </span>
          </>
        ) : (
          <p>Connect with the administrator key you saved during setup.</p>
        )}
        <Label>
          Administrator key
          <Input
            type="password"
            autoComplete="off"
            value={credential}
            onChange={(e) => setCredential(e.target.value)}
            required
            placeholder="ss_admin_…"
          />
        </Label>
        <Button type="submit" variant={sso.data?.enabled ? "outline" : "default"} disabled={busy}>
          {busy ? "Connecting…" : "Open console →"}
        </Button>

        {(error || ssoError) && (
          <p
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive"
          >
            {error || ssoError}
          </p>
        )}
        <div className="space-y-3 border-t pt-6 text-xs leading-6 text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1">
          <b>Need your administrator key?</b>
          <p>
            Recover it on your server with <code>docker compose exec api bun run admin:key</code>.
          </p>
          <p>Your key stays in this tab's memory. Refreshing signs you out.</p>
        </div>
        <a href="/api/docs">API reference ↗</a>
      </form>
    </main>
  );
}
