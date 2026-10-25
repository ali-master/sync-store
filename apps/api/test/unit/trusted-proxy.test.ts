import { expect, test } from "bun:test";
import { proxyTrust, socketProxyIdentity } from "../../src/trusted-proxy";

test("proxy trust validates the immediate peer instead of blindly trusting hop count", () => {
  const trust = proxyTrust("192.0.2.10,2001:db8::/64");
  expect(trust("192.0.2.10")).toBe(true);
  expect(trust("::ffff:192.0.2.10")).toBe(true);
  expect(trust("192.0.2.11")).toBe(false);
  expect(trust("192.0.2.10", 1)).toBe(false);
  expect(trust("2001:db8::1")).toBe(true);
  expect(proxyTrust()("127.0.0.1")).toBe(false);
  expect(() => proxyTrust("true")).toThrow();
  expect(() => proxyTrust("192.0.2.0/99")).toThrow();
});

test("untrusted socket peers cannot forge TLS or source IP", () => {
  expect(
    socketProxyIdentity("203.0.113.8", false, {
      "x-forwarded-proto": "https",
      "x-forwarded-for": "127.0.0.1",
    }),
  ).toEqual({ ip: "203.0.113.8", protocol: "http" });
});

test("socket proxy configuration loaded after module import matches HTTP trust", () => {
  const previous = process.env.TRUSTED_PROXY_CIDRS;
  process.env.TRUSTED_PROXY_CIDRS = "192.0.2.10";
  try {
    expect(
      socketProxyIdentity("192.0.2.10", false, {
        "x-forwarded-proto": "https",
        "x-forwarded-for": "203.0.113.8",
      }),
    ).toEqual({ ip: "203.0.113.8", protocol: "https" });
    expect(
      socketProxyIdentity("192.0.2.11", false, {
        "x-forwarded-proto": "https",
        "x-forwarded-for": "203.0.113.8",
      }),
    ).toEqual({ ip: "192.0.2.11", protocol: "http" });
  } finally {
    if (previous === undefined) delete process.env.TRUSTED_PROXY_CIDRS;
    else process.env.TRUSTED_PROXY_CIDRS = previous;
  }
});
