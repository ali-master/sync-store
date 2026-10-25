/** Configure browser access for header-authenticated clients, without ambient cookies. */
export function corsOptions(value = process.env.CORS_ALLOWED_ORIGINS) {
  const origins = (value ?? "*").split(",").map((origin) => origin.trim());
  if (origins.length === 1 && origins[0] === "*") {
    // Public SDK access is intentional; authorization remains enforced by API-key guards.
    return { origin: "*", credentials: false } as const;
  }
  for (const origin of origins) {
    let valid = false;
    try {
      const url = new URL(origin);
      valid =
        ["http:", "https:"].includes(url.protocol) &&
        url.origin === origin &&
        !origin.includes("*");
    } catch {
      // Reject malformed configuration instead of silently enabling public access.
    }
    if (!valid)
      throw new Error("CORS_ALLOWED_ORIGINS must contain exact HTTP(S) origins or a single *");
  }
  return { origin: origins, credentials: false } as const;
}

/** Read configuration after Nest loads environment files, including for Socket.IO. */
export function socketCorsOrigin(
  origin: string | undefined,
  callback: (error: Error | null, allow: boolean) => void,
) {
  const allowed = corsOptions().origin;
  callback(null, allowed === "*" || origin === undefined || allowed.includes(origin));
}
