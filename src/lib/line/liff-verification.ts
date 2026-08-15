const VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";
const LINE_ISSUER = "https://access.line.me";
const LINE_USER_ID_PATTERN = /^U[a-f0-9]{32}$/;

export class LineIdTokenVerificationError extends Error {
  constructor(public readonly code: "INVALID" | "TEMPORARY") {
    super("LINE ID token verification failed");
    this.name = "LineIdTokenVerificationError";
  }
}

function invalid(): never {
  throw new LineIdTokenVerificationError("INVALID");
}

/** Verifies signature and identity through LINE; browser-decoded claims are never trusted. */
export async function verifyLineIdToken({ idToken, channelId, now = new Date(), fetchFn = fetch }: { idToken: string; channelId: string; now?: Date; fetchFn?: typeof fetch }): Promise<{ lineUserId: string; displayName: string }> {
  let response: Response;
  try {
    response = await fetchFn(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: channelId }).toString(),
    });
  } catch {
    throw new LineIdTokenVerificationError("TEMPORARY");
  }
  if (!response.ok) invalid();

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    invalid();
  }
  if (!payload || typeof payload !== "object") invalid();
  const claims = payload as Record<string, unknown>;
  if (claims.iss !== LINE_ISSUER || claims.aud !== channelId) invalid();
  if (typeof claims.sub !== "string" || !LINE_USER_ID_PATTERN.test(claims.sub)) invalid();
  if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp <= Math.floor(now.getTime() / 1000)) invalid();
  const displayName = typeof claims.name === "string" ? claims.name.trim().slice(0, 200) : "";
  return { lineUserId: claims.sub, displayName };
}
