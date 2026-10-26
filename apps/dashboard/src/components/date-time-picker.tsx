import { useId, useState } from "react";
import { CalendarIcon } from "lucide-react";
import { Calendar } from "./ui/calendar";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { localExpiry } from "../lib/key-policy";

const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const minutes = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

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
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const date = value ? new Date(value) : undefined;
  const hour = value.slice(11, 13) || "23";
  const minute = value.slice(14, 16) || "59";
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Expiration date</Label>
      <input type="hidden" name={name} value={value} disabled={disabled} />
      <Popover open={!disabled && open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              id={id}
              type="button"
              variant="outline"
              disabled={disabled}
              className="h-10 w-full justify-start font-normal"
            />
          }
        >
          <CalendarIcon className="size-4 text-muted-foreground" />
          {date
            ? date.toLocaleString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })
            : "No expiration"}
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-auto max-w-[calc(100vw-2rem)] p-0"
          aria-label="Choose expiration date and time"
        >
          <Calendar
            mode="single"
            selected={date}
            defaultMonth={date}
            onSelect={(day) => {
              if (!day) {
                setValue("");
                return;
              }
              setValue(`${localExpiry(day.toISOString()).slice(0, 10)}T${hour}:${minute}`);
            }}
          />
          <div className="grid grid-cols-2 gap-3 border-t p-3">
            {[
              ["Hour", hour, hours],
              ["Minute", minute, minutes],
            ].map(([label, current, options]) => (
              <div key={String(label)} className="space-y-1">
                <span className="text-xs text-muted-foreground">{label}</span>
                <Select
                  value={current as string}
                  disabled={!date || disabled}
                  onValueChange={(next) => {
                    if (next === null || !value) return;
                    setValue(
                      (previous) =>
                        `${previous.slice(0, 10)}T${label === "Hour" ? next : previous.slice(11, 13)}:${label === "Minute" ? next : previous.slice(14, 16)}`,
                    );
                  }}
                >
                  <SelectTrigger
                    aria-label={`Expiration ${String(label).toLowerCase()}`}
                    className="w-full"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    {(options as string[]).map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3 border-t p-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => {
                setValue("");
                setOpen(false);
              }}
            >
              Clear date
            </Button>
            <Button type="button" size="sm" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
