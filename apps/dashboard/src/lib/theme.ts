export type Theme = "light" | "dark" | "system";
export const themeKey = "sync-store:console:theme";

/** Ignore invalid preferences and follow the device by default. */
export function parseTheme(value: unknown): Theme {
  return value === "light" || value === "dark" ? value : "system";
}

/** Keep native controls and portal surfaces in the same color scheme. */
export function applyTheme(theme: Theme, systemDark: boolean) {
  const dark = theme === "dark" || (theme === "system" && systemDark);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

export function readTheme(): Theme {
  try {
    return parseTheme(localStorage.getItem(themeKey));
  } catch {
    return "system";
  }
}
