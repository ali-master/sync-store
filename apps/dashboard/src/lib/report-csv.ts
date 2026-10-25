/** Quote CSV cells and neutralize spreadsheet formulas in administrator-controlled labels. */
export function reportCsv(rows: Record<string, unknown>[]) {
  const fields = [...new Set(rows.flatMap((row) => Object.keys(row)))].filter(
    (key) => key !== "_id",
  );
  const cell = (value: unknown) => {
    let text =
      value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
    if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return [
    fields.map(cell).join(","),
    ...rows.map((row) => fields.map((field) => cell(row[field])).join(",")),
  ].join("\r\n");
}
