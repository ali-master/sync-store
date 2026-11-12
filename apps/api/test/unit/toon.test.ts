import { expect, test } from "bun:test";
import { decode } from "@toon-format/toon";
import { modelText, TOON_MIME_TYPE } from "../../src/domains/mcp/toon.interceptor";

test("lists of records become one header and one row per record, and decode exactly", () => {
  const data = {
    total: 3,
    nextOffset: null,
    items: [
      { key: "cart/items", version: 2, value: "12", deleted: false },
      { key: "profile", version: 1, value: "true", deleted: true },
      { key: "theme, dark", version: 7, value: "null", deleted: false },
    ],
  };
  const { text, mimeType } = modelText(data);
  expect(mimeType).toBe(TOON_MIME_TYPE);
  expect(text).toContain("items[3]{key,version,value,deleted}:");
  expect(text.length).toBeLessThan(JSON.stringify(data).length * 0.8);
  // Strings that look like numbers, booleans or null, and text with the delimiter, survive as strings.
  expect(decode(text)).toEqual(data);
});

test("objects drop quotes and braces even when the text is not shorter", () => {
  const data = {
    found: true,
    item: { key: "preferences", value: { theme: "dark", sizes: [1, 2.5] } },
  };
  const { text, mimeType } = modelText(data);
  expect(mimeType).toBe(TOON_MIME_TYPE);
  expect(text).toStartWith("found: true\nitem:\n  key: preferences\n");
  expect(decode(text)).toEqual(data);
});

test("a value TOON would not make smaller stays compact JSON", () => {
  for (const data of [[], {}, [[1, [2, [3]]]], { a: [{ b: [{ c: 1 }] }] }]) {
    const { text, mimeType } = modelText(data);
    if (mimeType === TOON_MIME_TYPE) expect(decode(text)).toEqual(data as any);
    else expect(text).toBe(JSON.stringify(data));
  }
});
