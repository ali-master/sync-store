/** Reject invalid URL pagination before it can become an API request. */
export function validateSearch(search: Record<string, unknown>) {
  const page = Number(search.page ?? 1);
  return {
    page: Number.isInteger(page) && page >= 1 && page <= 10000 ? page : 1,
    ...(typeof search.scopeUser === "string" && search.scopeUser.trim()
      ? {
          scopeUser: search.scopeUser.trim().slice(0, 128),
          projectId:
            typeof search.projectId === "string" ? search.projectId.slice(0, 80) : "default",
          tenantId: typeof search.tenantId === "string" ? search.tenantId.slice(0, 80) : "",
          branch: typeof search.branch === "string" ? search.branch.slice(0, 80) : "main",
        }
      : {}),
    q: typeof search.q === "string" ? search.q.slice(0, 500) : "",
  };
}
