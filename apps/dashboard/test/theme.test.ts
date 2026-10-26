import { expect, test } from "bun:test";
import { applyTheme, parseTheme, readTheme } from "../src/lib/theme";

test("invalid appearance preferences follow the system", () => {
  expect(parseTheme("dark")).toBe("dark");
  expect(parseTheme("light")).toBe("light");
  for (const value of [null, "invalid", {}, "system"]) expect(parseTheme(value)).toBe("system");
});

test("appearance resolves explicit overrides and native control colors", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  let dark = false;
  const style = { colorScheme: "" };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      documentElement: {
        classList: {
          toggle: (_name: string, value: boolean) => {
            dark = value;
          },
        },
        style,
      },
    },
  });
  try {
    for (const [theme, system, expected] of [
      ["system", true, true],
      ["system", false, false],
      ["light", true, false],
      ["dark", false, true],
    ] as const) {
      applyTheme(theme, system);
      expect(dark).toBe(expected);
      expect(style.colorScheme).toBe(expected ? "dark" : "light");
    }
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("blocked browser storage does not prevent opening the console", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get: () => {
      throw new Error("blocked");
    },
  });
  try {
    expect(readTheme()).toBe("system");
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
