import { useState } from "react";
import { Gauge, Globe2, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { Checkbox } from "@/components/motion/checkbox";
import { Input } from "@/components/motion/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/motion/select";
import { httpMethods, localExpiry, quotaPeriods } from "../lib/key-policy";
import { DateTimePicker } from "./date-time-picker";
import { helpClass, labelClass, textareaClass } from "./inspector/sheet";

const summaryClass = "cursor-pointer text-sm font-semibold marker:text-muted-foreground";

/** Present every supported policy setting without exposing its storage format. */
export function KeyPolicyFields({
  policy,
  disabled,
}: {
  policy: Record<string, any>;
  disabled: boolean;
}) {
  // beUI checkboxes and selects hold no form value; hidden inputs carry these into the form.
  const [requireHttps, setRequireHttps] = useState(Boolean(policy.requireHttps));
  const [restrictionMode, setRestrictionMode] = useState<string | undefined>(
    policy.restrictionMode,
  );
  const [allowedMethods, setAllowedMethods] = useState<string[]>(() =>
    httpMethods.filter((method) => policy.allowedMethods?.includes(method)),
  );
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
    <fieldset disabled={disabled} className="min-w-0 space-y-5 disabled:opacity-60">
      <section className="space-y-4 border-t pt-5">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Gauge className="size-4 text-primary" aria-hidden="true" />
            Usage limits
          </h3>
          <p className={helpClass + " mt-1"}>
            Requests per period. Leave a field empty for unlimited access.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {quotaPeriods.map((period, index) => (
            <Input
              key={period}
              label={labels[index]}
              name={period + "Quota"}
              type="number"
              min={1}
              max={2147483647}
              step={1}
              placeholder="Unlimited"
              defaultValue={String(policy[period + "Quota"] ?? "")}
            />
          ))}
        </div>
      </section>
      <section className="space-y-4 border-t pt-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
          Security & expiration
        </h3>
        {requireHttps && <input type="hidden" name="requireHttps" value="on" />}
        <Checkbox
          className="flex rounded-xl border bg-card p-4"
          checked={requireHttps}
          onCheckedChange={setRequireHttps}
          disabled={disabled}
          label="Require HTTPS"
          description="Reject requests over an insecure connection."
        />
        <DateTimePicker
          key={policy.expiresAt || "none"}
          name="expiresAt"
          defaultValue={localExpiry(policy.expiresAt)}
          disabled={disabled}
        />
        <p className={helpClass}>Your local time zone. Leave empty for a key that never expires.</p>
      </section>
      <details className="border-t pt-5">
        <summary className={summaryClass}>
          <Globe2 className="mr-2 inline size-4 text-primary" aria-hidden="true" />
          Network restrictions
          <span className={helpClass + " mt-1 block font-normal"}>
            Control which addresses and websites can connect.
          </span>
        </summary>
        <div className="mt-5 space-y-4">
          <div className="space-y-1.5">
            <span className={labelClass}>IP rule behavior</span>
            <input type="hidden" name="restrictionMode" value={restrictionMode ?? ""} />
            <Select value={restrictionMode} onValueChange={setRestrictionMode} disabled={disabled}>
              <SelectTrigger>
                {/* The trigger takes no aria-label; this names it for screen readers. */}
                <span className="sr-only">IP rule behavior: </span>
                <SelectValue placeholder={restrictionMode} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="allow">Allow only listed IP addresses</SelectItem>
                <SelectItem value="deny">Block listed IP addresses</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {lists.slice(0, 2).map(([field, title, placeholder, help]) => (
            <label key={field} className="block space-y-1.5">
              <span className={labelClass}>{title}</span>
              <textarea
                name={field}
                defaultValue={
                  Array.isArray(policy[field]) ? policy[field].join("\n") : policy[field]
                }
                placeholder={placeholder}
                spellCheck={false}
                className={textareaClass + " min-h-20"}
              />
              <span className={helpClass + " block px-1"}>{help}</span>
            </label>
          ))}
        </div>
      </details>
      <details className="border-t pt-5">
        <summary className={summaryClass}>
          <SlidersHorizontal className="mr-2 inline size-4 text-primary" aria-hidden="true" />
          Advanced request rules
          <span className={helpClass + " mt-1 block font-normal"}>
            HTTP methods and user-agent filtering.
          </span>
        </summary>
        <div className="mt-5 space-y-4">
          <fieldset>
            <legend className="mb-3 px-1 text-sm font-medium">Allowed HTTP methods</legend>
            {allowedMethods.map((method) => (
              <input key={method} type="hidden" name="allowedMethods" value={method} />
            ))}
            <div className="flex flex-wrap gap-2">
              {httpMethods.map((method) => (
                <Checkbox
                  key={method}
                  className="rounded-xl border bg-card px-3 py-2 font-mono has-[[data-state=checked]]:border-primary/40 has-[[data-state=checked]]:bg-accent"
                  checked={allowedMethods.includes(method)}
                  onCheckedChange={(checked) =>
                    // Rebuilt from the full list so the submitted order never depends on click order.
                    setAllowedMethods((current) =>
                      httpMethods.filter((item) =>
                        item === method ? checked : current.includes(item),
                      ),
                    )
                  }
                  disabled={disabled}
                  label={method}
                />
              ))}
            </div>
            <p className={helpClass + " mt-2"}>
              No selection allows all methods. Read and write permissions still apply.
            </p>
          </fieldset>
          {lists.slice(2).map(([field, title, placeholder, help]) => (
            <label key={field} className="block space-y-1.5">
              <span className={labelClass}>{title}</span>
              <textarea
                name={field}
                defaultValue={
                  Array.isArray(policy[field]) ? policy[field].join("\n") : policy[field]
                }
                placeholder={placeholder}
                spellCheck={false}
                className={textareaClass + " min-h-20"}
              />
              <span className={helpClass + " block px-1"}>{help}</span>
            </label>
          ))}
        </div>
      </details>
    </fieldset>
  );
}
