import { createHash } from "node:crypto";

export function lineReservationName(kind: "code" | "token" | "user", value: string): string {
  return `line_link_${kind}_${createHash("sha256").update(value).digest("hex")}`;
}

export function isLineReservationConflict(error: unknown): boolean {
  const status = typeof error === "object" && error !== null && "response" in error
    ? (error as { response?: { status?: unknown } }).response?.status
    : undefined;
  return status === 400 && error instanceof Error && /named range.*already exists/i.test(error.message);
}
