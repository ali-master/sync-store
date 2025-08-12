export interface PartialSocket {
  remoteAddress?: string;
}

export interface PartialInfo {
  remoteAddress?: string;
}

export interface PartialIdentity {
  sourceIp?: string;
}

export interface PartialRequestContext {
  identity?: PartialIdentity;
}

export type HeaderLike =
  | {
      headers: Headers;
    }
  | {
      headers: Record<string, string | string[] | undefined>;
    };

export type RequestLike = {
  ip?: unknown;

  socket?: PartialSocket;

  info?: PartialInfo;

  requestContext?: PartialRequestContext;
} & HeaderLike;

export type Platform = "cloudflare" | "fly-io" | "vercel" | "arvancloud";
