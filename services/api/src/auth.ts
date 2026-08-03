import { createHmac, timingSafeEqual } from "node:crypto";
import type { AuthenticatedUser } from "./control-plane.js";

export type SessionClaims = {
  sub: string;
  email: string;
  role: "admin" | "standard";
  iat: number;
  exp: number;
};

const encode = (value: string | Buffer) => Buffer.from(value).toString("base64url");

function signingSecret() {
  // Docker intentionally passes optional values as empty strings. Do not ever
  // treat an omitted session secret as a valid empty HMAC key.
  return process.env.AUTH_TOKEN_SECRET
    || process.env.UPSTREAM_KEY_ENCRYPTION_SECRET
    || process.env.ADMIN_API_KEY
    || "development-only-session-secret";
}

function ttlSeconds() {
  const configured = Number(process.env.AUTH_TOKEN_TTL_SECONDS ?? 60 * 60 * 24 * 7);
  return Number.isFinite(configured) ? Math.min(Math.max(Math.trunc(configured), 300), 60 * 60 * 24 * 90) : 60 * 60 * 24 * 7;
}

function signature(value: string) {
  return encode(createHmac("sha256", signingSecret()).update(value).digest());
}

export function issueSessionToken(user: AuthenticatedUser) {
  const issuedAt = Math.floor(Date.now() / 1_000);
  const claims: SessionClaims = {
    sub: user.id,
    email: user.email,
    role: user.role,
    iat: issuedAt,
    exp: issuedAt + ttlSeconds(),
  };
  const header = encode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = encode(JSON.stringify(claims));
  return `${header}.${payload}.${signature(`${header}.${payload}`)}`;
}

export function verifySessionToken(token: string): SessionClaims | undefined {
  const [header, payload, suppliedSignature] = token.split(".");
  if (!header || !payload || !suppliedSignature) return undefined;
  const expected = signature(`${header}.${payload}`);
  const supplied = Buffer.from(suppliedSignature);
  const expectedBuffer = Buffer.from(expected);
  if (supplied.length !== expectedBuffer.length || !timingSafeEqual(supplied, expectedBuffer)) return undefined;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<SessionClaims>;
    if (
      typeof parsed.sub !== "string"
      || typeof parsed.email !== "string"
      || (parsed.role !== "admin" && parsed.role !== "standard")
      || typeof parsed.iat !== "number"
      || typeof parsed.exp !== "number"
      || parsed.exp <= Math.floor(Date.now() / 1_000)
    ) return undefined;
    return parsed as SessionClaims;
  } catch {
    return undefined;
  }
}
