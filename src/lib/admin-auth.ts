import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getInstallation } from "@/lib/installation/repository";
import type { GoogleOwnerIdentity } from "@/lib/installation/types";

const SESSION_COOKIE = "coaching_admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

type SessionPayload = { sub: string; email: string; exp: number };

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createAdminSessionValue(secret: string, identity: GoogleOwnerIdentity, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({
    sub: identity.googleSub,
    email: identity.email.trim().toLowerCase(),
    exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS,
  })).toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export function decodeAdminSession(value: string | undefined, secret: string, now = Date.now()): SessionPayload | null {
  if (!value || !secret) return null;
  const [payload, receivedSignature, ...extra] = value.split(".");
  if (!payload || !receivedSignature || extra.length) return null;
  const expectedSignature = signature(payload, secret);
  if (receivedSignature.length !== expectedSignature.length || !timingSafeEqual(Buffer.from(receivedSignature), Buffer.from(expectedSignature))) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionPayload;
    if (!decoded.sub || !/^[^@\s]+@[^@\s]+$/.test(decoded.email) || !Number.isFinite(decoded.exp) || decoded.exp <= Math.floor(now / 1000)) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function isValidAdminSession(value: string | undefined, secret: string, owner: GoogleOwnerIdentity, now = Date.now()): boolean {
  const decoded = decodeAdminSession(value, secret, now);
  return decoded?.sub === owner.googleSub && decoded.email === owner.email.trim().toLowerCase();
}

export function adminSecret(): string {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || secret === "CONFIG_REQUIRED") throw new Error("ADMIN_SECRET must be configured before admin access can be enabled");
  return secret;
}

export async function createAdminSession(identity: GoogleOwnerIdentity): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, createAdminSessionValue(adminSecret(), identity), adminSessionCookieOptions());
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

export async function getAdminSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  let secret: string;
  try {
    secret = adminSecret();
  } catch {
    return null;
  }
  const session = decodeAdminSession(cookieStore.get(SESSION_COOKIE)?.value, secret);
  if (!session) return null;
  const installation = await getInstallation();
  if (!installation || installation.ownerGoogleSub !== session.sub || installation.ownerEmail !== session.email) return null;
  return session;
}

export async function isAdminSession(): Promise<boolean> {
  return Boolean(await getAdminSession());
}

export async function requireAdmin(): Promise<SessionPayload> {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  return session;
}
