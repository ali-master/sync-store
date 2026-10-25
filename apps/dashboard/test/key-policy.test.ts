import { expect, test } from "bun:test";
import { localExpiry, readKeyPolicy } from "../src/lib/key-policy";

test("blank limits and rules preserve unrestricted API semantics", () => {
  const policy = readKeyPolicy(new FormData());
  expect(policy.minuteQuota).toBeNull();
  expect(policy.allowedMethods).toEqual([]);
  expect(policy.ipRestrictions).toEqual([]);
  expect(policy.requireHttps).toBe(false);
  expect(policy.expiresAt).toBeNull();
});

test("policy form serializes limits, line-separated rules and checkbox groups", () => {
  const data = new FormData();
  data.set("minuteQuota", "60");
  data.set("ipRestrictions", " 192.168.1.0/24\r\n\n127.0.0.1 ");
  data.set("restrictionMode", "deny");
  data.set("requireHttps", "on");
  data.append("allowedMethods", "GET");
  data.append("allowedMethods", "HEAD");
  expect(readKeyPolicy(data)).toMatchObject({
    minuteQuota: 60,
    ipRestrictions: ["192.168.1.0/24", "127.0.0.1"],
    restrictionMode: "deny",
    requireHttps: true,
    allowedMethods: ["GET", "HEAD"],
  });
  for (const value of ["0", "-1", "1.5", "NaN", "2147483648"]) {
    data.set("minuteQuota", value);
    expect(() => readKeyPolicy(data)).toThrow("Request limits");
  }
});

test("expiry preserves unchanged values and validates changed dates", () => {
  const data = new FormData();
  const expired = "2020-01-01T10:15:22.123Z";
  data.set("expiresAt", localExpiry(expired));
  expect(readKeyPolicy(data, expired)).not.toHaveProperty("expiresAt");
  expect(() => readKeyPolicy(data)).toThrow("future");
  data.set("expiresAt", "");
  expect(readKeyPolicy(data, expired).expiresAt).toBeNull();
  data.set("expiresAt", "2099-01-01T12:00");
  expect(readKeyPolicy(data).expiresAt).toBe(new Date("2099-01-01T12:00").toISOString());
});
