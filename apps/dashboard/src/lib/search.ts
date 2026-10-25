/** Reject invalid URL pagination before it can become an API request. */
export function validateSearch(search: Record<string, unknown>) {
  const page = Number(search.page ?? 1);
  return {
    page: Number.isInteger(page) && page >= 1 && page <= 10000 ? page : 1,
    q: typeof search.q === "string" ? search.q.slice(0, 500) : "",
  };
}
