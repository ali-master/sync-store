import { useState } from "react";
import { KeyPolicyFields } from "@/components/key-policy-fields";
import { Alert, AlertContent, AlertDescription, AlertIcon } from "@/components/motion/alert";
import { Button } from "@/components/motion/button/base";
import { Checkbox } from "@/components/motion/checkbox";
import { Input } from "@/components/motion/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/motion/select";
import { bootstrapId, policyFields, type Row } from "@/lib/console";
import { useConsole } from "@/lib/console-actions";
import { readKeyPolicy } from "@/lib/key-policy";
import { useSession } from "@/lib/session";
import { helpClass, labelClass, textareaClass } from "./sheet";

const accessClass =
  "rounded-xl border bg-card p-4 has-[[data-state=checked]]:border-primary/40 has-[[data-state=checked]]:bg-accent";

/** Give every policy field a value the form can show, decoding lists stored as JSON text. */
function keyPolicy(row: Row) {
  return Object.fromEntries(
    policyFields.map((field) => {
      let value =
        row[field] ??
        (field.endsWith("Quota") || field === "expiresAt"
          ? null
          : field === "requireHttps"
            ? false
            : field === "restrictionMode"
              ? "allow"
              : []);
      if (typeof value === "string" && value.startsWith("[")) {
        try {
          value = JSON.parse(value);
        } catch {
          /* Show invalid persisted configuration for correction. */
        }
      }
      return [field, value];
    }),
  );
}

/** Create an API key or change its access, policy, secret and activation. */
export function KeyInspector({
  selected,
  secret,
  projects,
  onSecret,
}: {
  selected: Row;
  secret: string;
  projects?: Row[];
  onSecret: (secret: string) => void;
}) {
  const { token, setToken } = useSession();
  const { request, run, busy, refresh, setConfirm, mutationDone } = useConsole();
  const [name, setName] = useState<string>(selected.name || "");
  const [canWrite, setCanWrite] = useState<boolean>(selected.canWrite ?? false);
  const [canRead, setCanRead] = useState<boolean>(selected.canRead ?? true);
  const rootKey = selected._id === bootstrapId;
  // The root key shows no access section, so its metadata is never read.
  const access = rootKey ? undefined : JSON.parse(selected.metadata || "{}").access;
  // The select has no form value of its own; the hidden input carries it into the submitted form.
  const [projectId, setProjectId] = useState<string>(access?.projectId || "default");
  return (
    <form
      key={selected._id || "new-key"}
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        void run(async () => {
          const policy = readKeyPolicy(data, selected._new ? null : selected.expiresAt);
          const body = { ...policy, name, canRead, canWrite };
          if (selected._new) {
            const result = await request("keys", "POST", body);
            onSecret(result.key);
            refresh();
          } else {
            await request("keys/" + selected._id, "PATCH", body);
            mutationDone("Key policy updated.");
          }
        });
      }}
    >
      <Input
        label="Name"
        required
        maxLength={250}
        placeholder="e.g. Production web app"
        value={name}
        onChange={setName}
        disabled={rootKey || busy}
      />
      {!rootKey && (
        <section className="space-y-4 border-t pt-5">
          <h3 className="text-sm font-semibold">Project & data access</h3>
          <div className="space-y-1.5">
            <span className={labelClass}>Project</span>
            <input type="hidden" name="projectId" value={projectId} />
            <Select
              value={projectId}
              onValueChange={setProjectId}
              disabled={!selected._new || busy}
            >
              <SelectTrigger>
                {/* The trigger takes no aria-label; this names it for screen readers. */}
                <span className="sr-only">Project: </span>
                <SelectValue placeholder={projectId} />
              </SelectTrigger>
              <SelectContent className="max-h-64 overflow-y-auto">
                <SelectItem value="default">Default (existing data)</SelectItem>
                {projects?.map((project) => (
                  <SelectItem key={project._id} value={project._id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className={helpClass}>
              Project binding cannot change after creation. Create projects from the Projects page.
            </p>
          </div>
          {(["readPrefixes", "writePrefixes"] as const).map((field) => (
            <label key={field} className="block space-y-1.5">
              <span className={labelClass}>
                {field === "readPrefixes" ? "Readable key prefixes" : "Writable key prefixes"}
              </span>
              <textarea
                name={field}
                rows={3}
                placeholder="settings/"
                className={textareaClass}
                defaultValue={(access?.[field] || []).join("\n")}
              />
            </label>
          ))}
          <p className={helpClass}>
            One literal prefix per line, case sensitive. Empty allows all keys for that permission.
            Do not add *. Restricted write keys cannot clear the entire project.
          </p>
        </section>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Checkbox
          className={accessClass}
          checked={canRead}
          onCheckedChange={setCanRead}
          disabled={rootKey || busy}
          label="Read access"
          description="Fetch and subscribe to stored data."
        />
        <Checkbox
          className={accessClass}
          checked={canWrite}
          onCheckedChange={setCanWrite}
          disabled={rootKey || busy}
          label="Write access"
          description="Create, update and delete data."
        />
      </div>
      {rootKey ? (
        <Alert variant="info">
          <AlertIcon />
          <AlertContent>
            <AlertDescription className="text-primary">
              Installation administrator. Permissions and activation are protected against lockout.
            </AlertDescription>
          </AlertContent>
        </Alert>
      ) : (
        <>
          <KeyPolicyFields policy={keyPolicy(selected)} disabled={busy} />
          <div className="sticky bottom-0 z-30 -mx-6 border-t bg-background/95 px-6 py-4 backdrop-blur">
            <Button
              className="w-full"
              type="submit"
              variant="primary"
              disabled={busy || (selected._new && Boolean(secret))}
            >
              {busy
                ? "Saving…"
                : selected._new && secret
                  ? "Key created"
                  : selected._new
                    ? "Create API key"
                    : "Save changes"}
            </Button>
            <p className={helpClass + " mt-2 text-center"}>
              {selected._new
                ? "Your secret will be shown once. Store it somewhere safe."
                : "Changes apply to new requests immediately."}
            </p>
          </div>
        </>
      )}
      {!selected._new && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            type="button"
            disabled={busy}
            onClick={() =>
              setConfirm({
                text: "Rotate this key? All clients using its old secret will need the replacement.",
                run: async () => {
                  const result = await request("keys/" + selected._id + "/rotate", "POST");
                  if (rootKey) setToken(result.key, token);
                  onSecret(result.key);
                  refresh();
                },
              })
            }
          >
            Rotate secret
          </Button>
          {!rootKey && (
            <Button
              type="button"
              variant={selected.isActive ? "outline" : "primary"}
              className={selected.isActive ? "text-destructive" : undefined}
              disabled={busy}
              onClick={() =>
                setConfirm({
                  text: (selected.isActive ? "Disable" : "Enable") + " this application key?",
                  run: async () => {
                    await request("keys/" + selected._id, "PATCH", {
                      isActive: !selected.isActive,
                    });
                    mutationDone("Key activation updated.");
                  },
                })
              }
            >
              {selected.isActive ? "Disable key" : "Enable key"}
            </Button>
          )}
        </div>
      )}
    </form>
  );
}
