import { BlockList, isIP } from "node:net";

/** Trust only an explicitly configured, directly connected terminating proxy. */
export function proxyTrust(value = process.env.TRUSTED_PROXY_CIDRS || "") {
  const list = new BlockList();
  for (const rule of value
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)) {
    const [address, prefix] = rule.split("/");
    const family = isIP(address);
    if (!family) throw new Error("TRUSTED_PROXY_CIDRS must contain IP addresses or CIDRs");
    const type = family === 4 ? "ipv4" : "ipv6";
    if (prefix === undefined) list.addAddress(address, type);
    else {
      const bits = Number(prefix);
      if (!/^\d+$/.test(prefix) || !Number.isInteger(bits) || bits > (family === 4 ? 32 : 128))
        throw new Error("Invalid TRUSTED_PROXY_CIDRS prefix");
      list.addSubnet(address, bits, type);
    }
  }
  return (address: string, hop = 0) => {
    const ip = address.replace(/^::ffff:/, "");
    return hop === 0 && Boolean(isIP(ip)) && list.check(ip, isIP(ip) === 4 ? "ipv4" : "ipv6");
  };
}

/** Socket.IO bypasses Fastify's request wrapper, so apply the same immediate-peer rule. */
export function socketProxyIdentity(
  address: string,
  secure: boolean,
  headers: Record<string, unknown>,
) {
  const forwarded = headers["x-forwarded-for"];
  const trusted = proxyTrust()(address);
  return {
    ip: trusted && typeof forwarded === "string" && isIP(forwarded) ? forwarded : address,
    protocol: secure || (trusted && headers["x-forwarded-proto"] === "https") ? "https" : "http",
  };
}
