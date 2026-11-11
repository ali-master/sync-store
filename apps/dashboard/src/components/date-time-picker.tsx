import { useId } from "react";

/** Pick a local expiration without changing the administration API's date contract. */
export function DateTimePicker({
  name,
  defaultValue,
  disabled,
}: {
  name: string;
  defaultValue: string;
  disabled: boolean;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block px-1 text-sm font-medium">
        Expiration date
      </label>
      {/* ponytail: the browser's own picker. Its value is the same local "YYYY-MM-DDTHH:mm" the
          form already submits; an empty field means no expiration. */}
      <input
        id={id}
        type="datetime-local"
        name={name}
        defaultValue={defaultValue}
        disabled={disabled}
        className="block h-11 w-full rounded-full border bg-transparent px-3.5 text-base outline-none transition-colors focus-visible:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60 dark:scheme-dark"
      />
    </div>
  );
}
