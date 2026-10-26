import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { applyTheme, parseTheme, readTheme, themeKey, type Theme } from "../lib/theme";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

const ThemeContext = createContext<{ theme: Theme; setTheme: (theme: Theme) => void }>({
  theme: "system",
  setTheme: () => {},
});

/** Sync appearance with device changes and other tabs without touching credentials. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, updateTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => applyTheme(theme, media.matches);
    const storage = (event: StorageEvent) => {
      if (event.key === themeKey || event.key === null) updateTheme(parseTheme(event.newValue));
    };
    update();
    media.addEventListener("change", update);
    window.addEventListener("storage", storage);
    return () => {
      media.removeEventListener("change", update);
      window.removeEventListener("storage", storage);
    };
  }, [theme]);
  function setTheme(value: Theme) {
    updateTheme(value);
    applyTheme(value, matchMedia("(prefers-color-scheme: dark)").matches);
    try {
      localStorage.setItem(themeKey, value);
    } catch {
      /* Keep appearance usable when storage is unavailable. */
    }
  }
  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function ThemePicker() {
  const { theme, setTheme } = useContext(ThemeContext);
  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  return (
    <Select
      value={theme}
      onValueChange={(value) => {
        if (value) setTheme(parseTheme(value));
      }}
      items={[
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
        { value: "system", label: "System" },
      ]}
    >
      <SelectTrigger
        aria-label="Appearance"
        className="h-8 gap-2 border-transparent bg-transparent text-muted-foreground shadow-none hover:bg-muted"
      >
        <Icon className="size-4" />
        <span className="sr-only sm:not-sr-only">
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent align="end" alignItemWithTrigger={false}>
        <SelectItem value="light">
          <Sun className="size-4" />
          Light
        </SelectItem>
        <SelectItem value="dark">
          <Moon className="size-4" />
          Dark
        </SelectItem>
        <SelectItem value="system">
          <Monitor className="size-4" />
          System
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
