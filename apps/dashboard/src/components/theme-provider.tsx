import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { applyTheme, parseTheme, readTheme, themeKey, type Theme } from "../lib/theme";
import { Button } from "./motion/button/base";

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

const order: Theme[] = ["light", "dark", "system"];

/** One button that steps through light, dark and the device setting. */
export function ThemePicker() {
  const { theme, setTheme } = useContext(ThemeContext);
  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  const next = order[(order.indexOf(theme) + 1) % order.length];
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(next)}
      aria-label={`Appearance: ${theme}. Switch to ${next}.`}
      title={`Appearance: ${theme}`}
    >
      <Icon className="size-4" />
    </Button>
  );
}
