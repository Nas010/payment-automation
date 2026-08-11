import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const SESSION_COOKIE = "coaching_admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8;

type SessionPayload = { exp: number };

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createAdminSessionValue(secret: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS })).toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export function isValidAdminSession(value: string | undefined, secret: string, now = Date.now()): boolean {
  if (!value || !secret) return false;
  const [payload, receivedSignature, ...extra] = value.split(".");
  if (!payload || !receivedSignature || extra.length) return false;
  const expectedSignature = signature(payload, secret);
  if (receivedSignature.length !== expectedSignature.length || !timingSafeEqual(Buffer.from(receivedSignature), Buffer.from(expectedSignature))) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionPayload;
    return Number.isFinite(decoded.exp) && decoded.exp > Math.floor(now / 1000);
  } catch {
    return false;
  }
}

export function adminSecret(): string {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || secret === "CONFIG_REQUIRED") throw new Error("ADMIN_SECRET must be configured before admin access can be enabled");
  return secret;
}

export function verifyAdminSecret(candidate: string): boolean {
  const secret = adminSecret();
  return candidate.length === secret.length && timingSafeEqual(Buffer.from(candidate), Buffer.from(secret));
}

export async function createAdminSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, createAdminSessionValue(adminSecret()), adminSessionCookieOptions());
}

export function adminSessionCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/admin";
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/admin",
    maxAge: SESSION_TTL_SECONDS,
  };
}

export async function clearAdminSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export async function isAdminSession(): Promise<boolean> {
  try {
    const cookieStore = await cookies();
    return isValidAdminSession(cookieStore.get(SESSION_COOKIE)?.value, adminSecret());
  } catch {
    return false;
  }
}

export async function requireAdmin(): Promise<void> {
  if (!(await isAdminSession())) redirect("/admin/login");
}
