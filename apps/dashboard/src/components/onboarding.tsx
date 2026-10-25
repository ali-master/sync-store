import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import logo from "../../../../assets/logo.svg";

/** Keep setup credentials in memory and unwrap the API's standard response envelope. */
async function setupRequest(body?: { code: string; name: string }) {
  const response = await fetch("/api/v1/setup", {
    method: body ? "POST" : "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
    ...(body
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.message || "Unable to complete setup. Try again or check the API logs.");
  return data.payload ?? data;
}

/** Guide a new installation through ownership verification, key creation and secure handoff. */
export function Onboarding({ children }: { children: ReactNode }) {
  const { token, setToken } = useSession();
  const cache = useQueryClient();
  const status = useQuery({
    queryKey: ["installation-setup"],
    queryFn: () => setupRequest(),
    enabled: !token,
  });
  const [step, setStep] = useState(0);
  const [code, setCode] = useState("");
  const [name, setName] = useState("Installation administrator");
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);
  const create = useMutation({
    mutationFn: () => setupRequest({ code: code.trim(), name: name.trim() }),
    onSuccess: (result) => {
      setKey(result.key);
      setCode("");
      setStep(2);
    },
  });
  if (token || (status.data?.required === false && !key)) return children;
  return (
    <main className="relative mx-auto grid min-h-screen max-w-6xl items-center gap-12 px-6 py-12 lg:grid-cols-2 lg:gap-24">
      <section className="space-y-8">
        <img src={logo} alt="Sync Store" className="size-14" />
        <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
          Welcome to your installation
        </p>
        <h1 className="text-5xl font-semibold leading-tight tracking-tight">
          Your data.
          <br />
          <span className="text-muted-foreground">Your control.</span>
        </h1>
        <p className="max-w-md leading-7 text-muted-foreground">
          A few simple steps to make this Sync Store yours. Create your administrator key, save it
          securely, and start connecting your applications.
        </p>
        <ol aria-label="Setup progress" className="space-y-4">
          {["Meet your console", "Create your administrator key", "Save and start"].map(
            (label, index) => (
              <li
                key={label}
                aria-current={step === index ? "step" : undefined}
                className={`flex items-center gap-4 text-sm ${step === index ? "font-medium text-foreground" : "text-muted-foreground"}`}
              >
                <span
                  className={`grid size-8 place-items-center rounded-full border text-xs ${index <= step ? "border-primary bg-primary text-primary-foreground" : ""}`}
                >
                  {index < step ? "✓" : index + 1}
                </span>
                {label}
              </li>
            ),
          )}
        </ol>
      </section>
      <Card className="gap-6 rounded-2xl p-7 shadow-sm sm:p-9">
        {status.isPending ? (
          <p role="status">Checking your installation…</p>
        ) : status.isError ? (
          <>
            <h2 className="text-2xl font-semibold">We couldn’t reach your API.</h2>
            <p role="alert" className="text-sm text-destructive">
              {status.error.message}
            </p>
            <Button onClick={() => void status.refetch()}>Try again</Button>
          </>
        ) : step === 0 ? (
          <>
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              A fresh start
            </span>
            <h2 className="text-3xl font-semibold tracking-tight">Let’s make it yours.</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              Your database is connected. No administrator key has been created yet.
            </p>
            <div className="rounded-xl bg-muted p-5 text-sm leading-6">
              You’ll need the <strong>setup code</strong> from your server logs. This proves you own
              the installation and keeps strangers from claiming it.
            </div>
            <Button onClick={() => setStep(1)}>Set up Sync Store →</Button>
          </>
        ) : step === 1 ? (
          <form
            className="space-y-6"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <h2 className="text-3xl font-semibold tracking-tight">Create your key.</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              Run <code className="rounded bg-muted px-1">docker compose logs api</code> and copy
              the value after <strong>Setup code:</strong>. For a source installation, use your API
              terminal output.
            </p>
            <Label className="flex-col items-start gap-2">
              Setup code
              <Input
                type="password"
                autoComplete="off"
                required
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="Paste your setup code"
              />
            </Label>
            <Label className="flex-col items-start gap-2">
              Administrator name
              <Input
                required
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Label>
            {create.isError && (
              <div role="alert" className="space-y-2 text-sm text-destructive">
                <p>{create.error.message}</p>
                <p>
                  If a previous request completed but its response was lost, recover the key with{" "}
                  <code>docker compose exec api bun run admin:key</code>.
                </p>
                <Button type="button" variant="outline" onClick={() => void status.refetch()}>
                  Check installation status
                </Button>
              </div>
            )}
            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={create.isPending}
                onClick={() => setStep(0)}
              >
                Back
              </Button>
              <Button type="submit" disabled={create.isPending || !code.trim() || !name.trim()}>
                {create.isPending ? "Creating…" : "Create administrator key →"}
              </Button>
            </div>
          </form>
        ) : (
          <>
            <span className="text-xs uppercase tracking-widest text-primary">
              Installation ready
            </span>
            <h2 className="text-3xl font-semibold tracking-tight">One key. Keep it safe.</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              Save this key in your password manager. It grants full access to your installation and
              is shown only here. Use separate application keys for your SDK clients.
            </p>
            <Label className="flex-col items-start gap-2">
              Your administrator key
              <Input
                readOnly
                value={key}
                className="font-mono text-xs"
                onFocus={(event) => event.target.select()}
              />
            </Label>
            <Label className="items-start gap-3 leading-6">
              <Checkbox checked={saved} onCheckedChange={(checked) => setSaved(checked === true)} />
              I saved my administrator key somewhere safe.
            </Label>
            <Button
              disabled={!saved}
              onClick={() => {
                setToken(key);
                setKey("");
                create.reset();
                cache.setQueryData(["installation-setup"], { required: false });
              }}
            >
              Open my console →
            </Button>
            <p className="text-xs leading-5 text-muted-foreground">
              Next: open API keys → Create key to issue a credential for your application.
            </p>
          </>
        )}
      </Card>
    </main>
  );
}
