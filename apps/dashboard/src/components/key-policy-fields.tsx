import { useId } from "react";
import { Gauge, Globe2, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { Checkbox } from "./ui/checkbox";
import { NativeSelect } from "./ui/native-select";
import { httpMethods, localExpiry, quotaPeriods } from "../lib/key-policy";

/** Present every supported policy setting without exposing its storage format. */
export function KeyPolicyFields({
  policy,
  disabled,
}: {
  policy: Record<string, any>;
  disabled: boolean;
}) {
  const restrictionModeId = useId();
  const labels = ["Per minute", "Per hour", "Per day", "Per month"];
  const lists = [
    [
      "ipRestrictions",
      "IP addresses",
      "192.168.1.0/24",
      "One IP address or CIDR per line. Empty means no IP restriction.",
    ],
    [
      "websiteOrigins",
      "Website hostnames",
      "app.example.com",
      "One hostname per line. Empty allows any origin.",
    ],
    [
      "allowedUserAgents",
      "Allowed user agents",
      "MyApp",
      "One matching pattern per line. Empty allows any user agent.",
    ],
    [
      "blockedUserAgents",
      "Blocked user agents",
      "unwanted-client",
      "One matching pattern per line. Matching clients are blocked.",
    ],
  ];
  return (
    <fieldset disabled={disabled} className="space-y-6 disabled:opacity-60">
      <section className="rounded-2xl border bg-muted/20 p-5">
        <h3 className="flex items-center gap-2 font-semibold">
          <Gauge className="size-4 text-primary" />
          Usage limits
        </h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Requests per period. Leave a field empty for unlimited access.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-4">
          {quotaPeriods.map((period, index) => (
            <Label key={period}>
              {labels[index]}
              <Input
                name={period + "Quota"}
                type="number"
                min={1}
                max={2147483647}
                step={1}
                placeholder="Unlimited"
                defaultValue={policy[period + "Quota"] ?? ""}
                className="h-10 bg-background"
              />
            </Label>
          ))}
        </div>
      </section>
      <section className="space-y-4 rounded-2xl border p-5">
        <h3 className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="size-4 text-primary" />
          Security & expiration
        </h3>
        <Label className="flex-row! items-center! rounded-xl bg-muted/40 p-3">
          <Checkbox name="requireHttps" defaultChecked={policy.requireHttps} disabled={disabled} />
          <span>
            Require HTTPS
            <span className="mt-1 block text-xs font-normal text-muted-foreground">
              Reject requests over an insecure connection.
            </span>
          </span>
        </Label>
        <Label>
          Expiration date
          <Input
            name="expiresAt"
            type="datetime-local"
            defaultValue={localExpiry(policy.expiresAt)}
            className="h-10"
          />
        </Label>
        <p className="text-xs text-muted-foreground">
          Your local time zone. Leave empty for a key that never expires.
        </p>
      </section>
      <details className="group rounded-2xl border p-5">
        <summary className="cursor-pointer text-sm font-semibold marker:text-muted-foreground">
          <Globe2 className="mr-2 inline size-4 text-primary" />
          Network restrictions
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            Control which addresses and websites can connect.
          </span>
        </summary>
        <div className="mt-5 space-y-4">
          <div className="space-y-2">
            <Label htmlFor={restrictionModeId}>IP rule behavior</Label>
            <NativeSelect
              id={restrictionModeId}
              name="restrictionMode"
              defaultValue={policy.restrictionMode}
              className="w-full"
            >
              <option value="allow">Allow only listed IP addresses</option>
              <option value="deny">Block listed IP addresses</option>
            </NativeSelect>
          </div>
          {lists.slice(0, 2).map(([field, title, placeholder, help]) => (
            <Label key={field}>
              {title}
              <Textarea
                name={field}
                defaultValue={
                  Array.isArray(policy[field]) ? policy[field].join("\n") : policy[field]
                }
                placeholder={placeholder}
                spellCheck={false}
                className="min-h-20 font-mono text-xs"
              />
              <span className="text-xs font-normal leading-5 text-muted-foreground">{help}</span>
            </Label>
          ))}
        </div>
      </details>
      <details className="rounded-2xl border p-5">
        <summary className="cursor-pointer text-sm font-semibold marker:text-muted-foreground">
          <SlidersHorizontal className="mr-2 inline size-4 text-primary" />
          Advanced request rules
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            HTTP methods and user-agent filtering.
          </span>
        </summary>
        <div className="mt-5 space-y-4">
          <fieldset>
            <legend className="mb-3 text-sm font-medium">Allowed HTTP methods</legend>
            <div className="flex flex-wrap gap-2">
              {httpMethods.map((method) => (
                <Label
                  key={method}
                  className="flex-row! items-center! rounded-lg border px-3 py-2 font-mono text-xs has-[[data-checked]]:border-primary/40 has-[[data-checked]]:bg-primary/5"
                >
                  <Checkbox
                    name="allowedMethods"
                    disabled={disabled}
                    value={method}
                    defaultChecked={policy.allowedMethods?.includes(method)}
                  />
                  {method}
                </Label>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              No selection allows all methods. Read and write permissions still apply.
            </p>
          </fieldset>
          {lists.slice(2).map(([field, title, placeholder, help]) => (
            <Label key={field}>
              {title}
              <Textarea
                name={field}
                defaultValue={
                  Array.isArray(policy[field]) ? policy[field].join("\n") : policy[field]
                }
                placeholder={placeholder}
                spellCheck={false}
                className="min-h-20"
              />
              <span className="text-xs font-normal leading-5 text-muted-foreground">{help}</span>
            </Label>
          ))}
        </div>
      </details>
    </fieldset>
  );
}
