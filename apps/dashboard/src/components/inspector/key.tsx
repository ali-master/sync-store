import { useState } from "react";
import { KeyPolicyFields } from "@/components/key-policy-fields";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { bootstrapId, policyFields, type Row } from "@/lib/console";
import { useConsole } from "@/lib/console-actions";
import { readKeyPolicy } from "@/lib/key-policy";
import { useSession } from "@/lib/session";

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
  return (
    <form
      key={selected._id || "new-key"}
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
      <Label>
        Name
        <Input
          required
          maxLength={250}
          placeholder="e.g. Production web app"
          className="h-11"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={rootKey || busy}
        />
      </Label>
      {!rootKey && (
        <section className="space-y-4 rounded-2xl border bg-muted/20 p-5">
          <h3 className="font-semibold">Project & data access</h3>
          <Label>
            Project
            {!selected._new && (
              <input
                type="hidden"
                name="projectId"
                value={JSON.parse(selected.metadata || "{}").access?.projectId || "default"}
              />
            )}
            <Select
              items={[
                { value: "default", label: "Default (existing data)" },
                ...(projects || []).map((project) => ({
                  value: project._id,
                  label: project.name,
                })),
              ]}
              name="projectId"
              disabled={!selected._new || busy}
              defaultValue={JSON.parse(selected.metadata || "{}").access?.projectId || "default"}
            >
              <SelectTrigger aria-label="Project" className="w-full min-w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectItem value="default">Default (existing data)</SelectItem>
                {projects?.map((project) => (
                  <SelectItem key={project._id} value={project._id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>
          <p className="text-xs text-muted-foreground">
            Project binding cannot change after creation. Create projects from the Projects page.
          </p>
          {(["readPrefixes", "writePrefixes"] as const).map((field) => (
            <Label key={field}>
              {field === "readPrefixes" ? "Readable key prefixes" : "Writable key prefixes"}
              <Textarea
                name={field}
                rows={3}
                placeholder="settings/"
                defaultValue={(JSON.parse(selected.metadata || "{}").access?.[field] || []).join(
                  "\n",
                )}
              />
            </Label>
          ))}
          <p className="text-xs text-muted-foreground">
            One literal prefix per line, case sensitive. Empty allows all keys for that permission.
            Do not add *. Restricted write keys cannot clear the entire project.
          </p>
        </section>
      )}
      <div className="grid grid-cols-2 gap-3 [&_label]:flex-row! [&_label]:items-start!">
        <Label className="rounded-xl border bg-muted/20 p-4 has-[[data-checked]]:border-primary/40 has-[[data-checked]]:bg-primary/5">
          <Checkbox checked={canRead} onCheckedChange={setCanRead} disabled={rootKey || busy} />
          <span>
            Read access
            <span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">
              Fetch and subscribe to stored data.
            </span>
          </span>
        </Label>
        <Label className="rounded-xl border bg-muted/20 p-4 has-[[data-checked]]:border-primary/40 has-[[data-checked]]:bg-primary/5">
          <Checkbox checked={canWrite} onCheckedChange={setCanWrite} disabled={rootKey || busy} />
          <span>
            Write access
            <span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">
              Create, update and delete data.
            </span>
          </span>
        </Label>
      </div>
      {rootKey ? (
        <p className="rounded-lg border border-primary/15 bg-primary/5 p-4 text-sm text-primary">
          Installation administrator. Permissions and activation are protected against lockout.
        </p>
      ) : (
        <>
          <KeyPolicyFields policy={keyPolicy(selected)} disabled={busy} />
          <div className="sticky bottom-0 -mx-2 border-t bg-popover/95 px-2 py-4 backdrop-blur">
            <Button
              className="h-11 w-full"
              type="submit"
              variant="default"
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
            <p className="mt-2 text-center text-xs text-muted-foreground">
              {selected._new
                ? "Your secret will be shown once. Store it somewhere safe."
                : "Changes apply to new requests immediately."}
            </p>
          </div>
        </>
      )}
      {!selected._new && (
        <>
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
              variant={selected.isActive ? "destructive" : "default"}
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
        </>
      )}
    </form>
  );
}
