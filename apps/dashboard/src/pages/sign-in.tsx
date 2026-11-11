import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ArrowUpRight, KeyRound } from "lucide-react";
import { Alert, AlertContent, AlertIcon, AlertTitle } from "@/components/motion/alert";
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
import { AccessLayout } from "@/components/onboarding";
import { useConsole } from "@/lib/console-actions";
import { useSession } from "@/lib/session";
import { readSsoReturn, ssoRequest } from "@/lib/sso";

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
    <AccessLayout
      label="Sync Store console"
      title={
        <>
          Everything connected.
          <br />
          <span className="text-muted-foreground">Everything in view.</span>
        </>
      }
      lede="A quiet place to manage your data, credentials and connections."
    >
      <Card className="bg-card shadow-sm">
        <CardHeader>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Your installation
          </p>
          <CardTitle as="h2" className="text-2xl tracking-tight">
            Welcome back.
          </CardTitle>
          <CardDescription>
            {sso.data?.enabled
              ? "Sign in with your organization account, or use the administrator key."
              : "Connect with the administrator key you saved during setup."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {sso.data?.enabled && (
            <>
              <Button
                size="lg"
                className="w-full"
                onClick={() => location.assign("/api/v1/sso/login")}
              >
                Continue with {sso.data.name}
                <ArrowRight className="size-4" aria-hidden="true" />
              </Button>
              <p className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" aria-hidden="true" />
                Or connect with the administrator key
                <span className="h-px flex-1 bg-border" aria-hidden="true" />
              </p>
            </>
          )}
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await request("overview", "GET", undefined, credential.trim());
                setToken(credential.trim());
                setCredential("");
              });
            }}
          >
            <Input
              label="Administrator key"
              type="password"
              autoComplete="off"
              value={credential}
              onChange={setCredential}
              required
              placeholder="ss_admin_…"
              leftIcon={<KeyRound />}
            />
            <Button
              type="submit"
              size="lg"
              className="w-full"
              variant={sso.data?.enabled ? "outline" : "primary"}
              disabled={busy}
            >
              {busy ? (
                <>
                  <span aria-hidden="true" className="inline-flex">
                    <Loader size={16} className="text-current" />
                  </span>
                  Connecting…
                </>
              ) : (
                <>
                  Open console
                  <ArrowRight className="size-4" aria-hidden="true" />
                </>
              )}
            </Button>
          </form>
          {(error || ssoError) && (
            <Alert variant="destructive">
              <AlertIcon />
              <AlertContent>
                <AlertTitle className="break-words">{error || ssoError}</AlertTitle>
              </AlertContent>
            </Alert>
          )}
          <div className="space-y-2 rounded-xl bg-muted p-4 text-xs leading-6 text-muted-foreground">
            <p className="font-medium text-foreground">Need your administrator key?</p>
            <p>
              Recover it on your server with{" "}
              <code className="rounded bg-background px-1 font-mono">
                docker compose exec api bun run admin:key
              </code>
              .
            </p>
            <p>Your key stays in this tab's memory. Refreshing signs you out.</p>
          </div>
          <a
            href="/api/docs"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            API reference
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </a>
        </CardContent>
      </Card>
    </AccessLayout>
  );
}
