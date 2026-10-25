import { expect, test } from "bun:test";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { corsOptions, socketCorsOrigin } from "../../src/cors";

test("CORS allows explicit origins without enabling browser credentials", async () => {
  const adapter = new FastifyAdapter();
  adapter.enableCors(corsOptions("https://app.example.com,https://docs.example.com"));
  const server = adapter.getInstance();
  try {
    for (const [origin, allowed] of [
      ["https://app.example.com", true],
      ["https://evil.example", false],
    ] as const) {
      const response = await server.inject({
        method: "OPTIONS",
        url: "/api/v1/keys",
        headers: {
          origin,
          "access-control-request-method": "POST",
          "access-control-request-headers": "x-api-key,idempotency-key",
        },
      });
      expect(response.headers["access-control-allow-origin"]).toBe(allowed ? origin : undefined);
      expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
    }
  } finally {
    await server.close();
  }
});

test("public SDK CORS is explicitly noncredentialed and invalid lists fail closed", () => {
  expect(corsOptions("*")).toEqual({ origin: "*", credentials: false });
  for (const value of [
    "",
    "null",
    "*,https://app.example.com",
    "https://app.example.com/path",
    "https://user:pass@app.example.com",
    "https://*.example.com",
  ]) {
    expect(() => corsOptions(value)).toThrow();
  }
});

test("socket CORS reads the origin list after module import", () => {
  const previous = process.env.CORS_ALLOWED_ORIGINS;
  process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com";
  try {
    socketCorsOrigin("https://app.example.com", (error, allow) => {
      expect(error).toBeNull();
      expect(allow).toBe(true);
    });
    socketCorsOrigin("https://evil.example", (error, allow) => {
      expect(error).toBeNull();
      expect(allow).toBe(false);
    });
  } finally {
    if (previous === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
    else process.env.CORS_ALLOWED_ORIGINS = previous;
  }
});
