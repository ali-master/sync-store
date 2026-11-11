import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  Copy,
  KeyRound,
  RefreshCw,
  Server,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import {
  Alert,
  AlertAction,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
} from "@/components/motion/alert";
import { Button } from "@/components/motion/button/base";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/motion/card";
import { Checkbox } from "@/components/motion/checkbox";
import { Input } from "@/components/motion/input";
import { Loader } from "@/components/motion/loader";
import { ThemePicker } from "@/components/theme-provider";
import { useSession } from "@/lib/session";
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

const proofPoints: [icon: LucideIcon, title: string, detail: string][] = [
  [Server, "Your data stays on your server", "This console works through your own API."],
  [
    KeyRound,
    "Credentials stay in this tab's memory",
    "Your key is never written to browser storage.",
  ],
  [
    RefreshCw,
    "Every change is synchronized",
    "Writes reach each connected client and are kept in history.",
  ],
];

const eyebrow = "text-[11px] font-semibold uppercase tracking-[0.18em]";
const inlineCode = "rounded bg-muted px-1 font-mono text-xs";

/** The full-screen frame shared by first-time setup and sign-in: the brand, then one form card. */
export function AccessLayout({
  label,
  title,
  lede,
  children,
}: {
  label: string;
  title: ReactNode;
  lede: string;
  children: ReactNode;
}) {
  return (
    <main className="relative grid min-h-screen bg-background lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <div className="absolute right-4 top-4 z-10">
        <ThemePicker />
      </div>
      <section className="flex flex-col gap-10 border-b bg-card px-6 py-10 sm:px-10 lg:justify-between lg:border-b-0 lg:border-r lg:px-16 lg:py-14">
        <div className="flex items-center gap-3">
          <img src={logo} alt="Sync Store" className="size-10" />
          <p className={eyebrow + " text-muted-foreground"}>{label}</p>
        </div>
        <div className="max-w-lg space-y-5">
          <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
            {title}
          </h1>
          <p className="max-w-md leading-7 text-muted-foreground">{lede}</p>
        </div>
        <ul className="grid max-w-lg gap-5">
          {proofPoints.map(([Icon, name, detail]) => (
            <li key={name} className="flex gap-4">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <div className="text-sm leading-6">
                <p className="font-medium">{name}</p>
                <p className="text-muted-foreground">{detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className="flex items-center justify-center px-4 py-10 sm:px-8 lg:py-14">
        <div className="w-full max-w-md">{children}</div>
      </section>
    </main>
  );
}

const steps = ["Meet your console", "Create your administrator key", "Save and start"];

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
  const [copyLabel, setCopyLabel] = useState("Copy");
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
    <AccessLayout
      label="Welcome to your installation"
      title={
        <>
          Your data.
          <br />
          <span className="text-muted-foreground">Your control.</span>
        </>
      }
      lede="A few simple steps to make this Sync Store yours. Create your administrator key, save it securely, and start connecting your applications."
    >
      <Card className="bg-card shadow-sm">
        <CardContent className="border-b pb-6">
          <ol aria-label="Setup progress" className="flex items-start">
            {steps.map((label, index) => (
              <li
                key={label}
                aria-current={step === index ? "step" : undefined}
                className="relative flex flex-1 flex-col items-center gap-2 px-1 text-center"
              >
                {index < steps.length - 1 && (
                  <span
                    aria-hidden="true"
                    className={
                      "absolute left-1/2 top-4 h-px w-full " +
                      (index < step ? "bg-primary" : "bg-border")
                    }
                  />
                )}
                <span
                  className={
                    "relative grid size-8 place-items-center rounded-full border text-xs font-semibold " +
                    (index < step
                      ? "border-primary bg-primary text-primary-foreground"
                      : index === step
                        ? "border-primary bg-card text-primary ring-4 ring-primary/15"
                        : "bg-card text-muted-foreground")
                  }
                >
                  {index < step ? <Check className="size-4" aria-hidden="true" /> : index + 1}
                </span>
                <span
                  className={
                    "text-xs leading-4 " +
                    (index === step ? "font-medium text-foreground" : "text-muted-foreground")
                  }
                >
                  {index < step && <span className="sr-only">Completed: </span>}
                  {label}
                </span>
              </li>
            ))}
          </ol>
        </CardContent>
        {status.isPending ? (
          <CardContent className="flex items-center gap-3 text-muted-foreground">
            <Loader size={18} label="Checking your installation…" />
            <span aria-hidden="true">Checking your installation…</span>
          </CardContent>
        ) : status.isError ? (
          <>
            <CardHeader>
              <CardTitle as="h2" className="text-2xl tracking-tight">
                We couldn’t reach your API.
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <Alert variant="destructive">
                <AlertIcon />
                <AlertContent>
                  <AlertTitle className="break-words">{status.error.message}</AlertTitle>
                </AlertContent>
              </Alert>
              <Button onClick={() => void status.refetch()}>Try again</Button>
            </CardContent>
          </>
        ) : step === 0 ? (
          <>
            <CardHeader>
              <p className={eyebrow + " text-muted-foreground"}>A fresh start</p>
              <CardTitle as="h2" className="text-2xl tracking-tight">
                Let’s make it yours.
              </CardTitle>
              <CardDescription>
                Your database is connected. No administrator key has been created yet.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <p className="rounded-xl bg-muted p-4 leading-6">
                You’ll need the <strong>setup code</strong> from your server logs. This proves you
                own the installation and keeps strangers from claiming it.
              </p>
              <Button size="lg" className="w-full" onClick={() => setStep(1)}>
                Set up Sync Store
                <ArrowRight className="size-4" aria-hidden="true" />
              </Button>
            </CardContent>
          </>
        ) : step === 1 ? (
          <>
            <CardHeader>
              <CardTitle as="h2" className="text-2xl tracking-tight">
                Create your key.
              </CardTitle>
              <CardDescription>
                Run <code className={inlineCode}>docker compose logs api</code> and copy the value
                after <strong>Setup code:</strong>. For a source installation, use your API terminal
                output.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  create.mutate();
                }}
              >
                <Input
                  label="Setup code"
                  type="password"
                  autoComplete="off"
                  required
                  value={code}
                  onChange={setCode}
                  placeholder="Paste your setup code"
                  leftIcon={<KeyRound />}
                />
                <Input
                  label="Administrator name"
                  required
                  maxLength={100}
                  value={name}
                  onChange={setName}
                />
                {create.isError && (
                  <Alert variant="destructive">
                    <AlertIcon />
                    <AlertContent>
                      <AlertTitle className="break-words">{create.error.message}</AlertTitle>
                      <AlertDescription>
                        If a previous request completed but its response was lost, recover the key
                        with{" "}
                        <code className="font-mono text-xs">
                          docker compose exec api bun run admin:key
                        </code>
                        .
                      </AlertDescription>
                      <AlertAction>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void status.refetch()}
                        >
                          Check installation status
                        </Button>
                      </AlertAction>
                    </AlertContent>
                  </Alert>
                )}
                <div className="flex flex-wrap gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={create.isPending}
                    onClick={() => setStep(0)}
                  >
                    Back
                  </Button>
                  <Button
                    type="submit"
                    className="flex-1"
                    disabled={create.isPending || !code.trim() || !name.trim()}
                  >
                    {create.isPending ? (
                      <>
                        <span aria-hidden="true" className="inline-flex">
                          <Loader size={16} className="text-current" />
                        </span>
                        Creating…
                      </>
                    ) : (
                      <>
                        Create administrator key
                        <ArrowRight className="size-4" aria-hidden="true" />
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader>
              <p className={eyebrow + " text-primary"}>Installation ready</p>
              <CardTitle as="h2" className="text-2xl tracking-tight">
                One key. Keep it safe.
              </CardTitle>
              <CardDescription>
                Save this key in your password manager. It grants full access to your installation
                and is shown only here. Use separate application keys for your SDK clients.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="overflow-hidden rounded-xl bg-foreground text-background">
                <div className="flex items-center justify-between gap-3 border-b border-background/15 py-1.5 pl-4 pr-1.5">
                  <label htmlFor="administrator-key" className={eyebrow + " text-background/70"}>
                    Your administrator key
                  </label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-background/80 hover:bg-background/15 hover:text-background"
                    onClick={() =>
                      void navigator.clipboard.writeText(key).then(
                        () => setCopyLabel("Copied"),
                        () => setCopyLabel("Select the key to copy"),
                      )
                    }
                  >
                    {copyLabel === "Copied" ? (
                      <Check className="size-3.5" aria-hidden="true" />
                    ) : (
                      <Copy className="size-3.5" aria-hidden="true" />
                    )}
                    <span aria-live="polite">{copyLabel}</span>
                  </Button>
                </div>
                <textarea
                  id="administrator-key"
                  readOnly
                  rows={3}
                  value={key}
                  onFocus={(event) => event.target.select()}
                  className="block field-sizing-content w-full resize-none break-all bg-transparent px-4 py-3 font-mono text-sm leading-6 outline-none selection:bg-background/25 focus-visible:bg-background/10"
                />
              </div>
              <p className="flex items-start gap-2 text-xs font-medium leading-5">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                This key is shown only once. Copy it before you open your console.
              </p>
              <Checkbox
                checked={saved}
                onCheckedChange={setSaved}
                label="I saved my administrator key somewhere safe."
              />
              <Button
                size="lg"
                className="w-full"
                disabled={!saved}
                onClick={() => {
                  setToken(key);
                  setKey("");
                  create.reset();
                  cache.setQueryData(["installation-setup"], { required: false });
                }}
              >
                Open my console
                <ArrowRight className="size-4" aria-hidden="true" />
              </Button>
              <p className="text-xs leading-5 text-muted-foreground">
                Next: open API keys → Create key to issue a credential for your application.
              </p>
            </CardContent>
          </>
        )}
      </Card>
    </AccessLayout>
  );
}
