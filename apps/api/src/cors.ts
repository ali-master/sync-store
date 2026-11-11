import { setting } from "./domains/settings/settings.store";

/** Configure browser access for header-authenticated clients, without ambient cookies. */
export function corsOptions(value = setting("CORS_ALLOWED_ORIGINS")) {
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

/** Whether a browser page on this origin may call the API; read on every request. */
export function originAllowed(origin: string | undefined): boolean {
  const allowed = corsOptions().origin;
  return allowed === "*" || origin === undefined || allowed.includes(origin);
}

/** Read configuration after Nest loads environment files, including for Socket.IO. */
export function socketCorsOrigin(
  origin: string | undefined,
  callback: (error: Error | null, allow: boolean) => void,
) {
  callback(null, originAllowed(origin));
}
