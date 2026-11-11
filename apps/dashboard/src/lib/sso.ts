/** Read the marker the API leaves in the URL fragment after a single sign-on redirect. */
export function readSsoReturn(hash: string): { collect: boolean; error: string } {
  if (hash === "#sso") return { collect: true, error: "" };
  if (!hash.startsWith("#sso-error=")) return { collect: false, error: "" };
  let message = "Sign-in failed. Try again.";
  try {
    message = decodeURIComponent(hash.slice("#sso-error=".length)) || message;
  } catch {
    // A malformed fragment still deserves a readable message.
  }
  return { collect: false, error: message.slice(0, 300) };
}

/** Call the public single sign-on endpoints; the session cookie is HttpOnly and same-origin. */
export async function ssoRequest(path = "", method = "GET") {
  const response = await fetch("/api/v1/sso" + path, {
    method,
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Single sign-on is unavailable.");
  return data.payload ?? data;
}
