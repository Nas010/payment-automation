import type { ClientRecord } from "@/lib/sheets/clients";

export type LineProfileDependencies = {
  listClients: () => Promise<ClientRecord[]>;
  updateLineLinkClient: (input: { client: ClientRecord; expectedClient: ClientRecord }) => Promise<boolean>;
};

export type LineProfilePictureStatus = "present" | "missing" | "rejected";

export function normalizeLinePictureUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : "";
  } catch {
    return "";
  }
}

export function lineProfilePictureStatus(value: unknown): LineProfilePictureStatus {
  if (typeof value !== "string" || value.length === 0) return "missing";
  return normalizeLinePictureUrl(value) ? "present" : "rejected";
}

function sheetSafeDisplayName(displayName: string): string {
  return /^[=+\-@]/.test(displayName) ? `'${displayName}` : displayName;
}

export async function persistLineProfile(
  dependencies: LineProfileDependencies,
  input: { lineUserId: string; displayName: string; pictureUrl: string; now: Date | string },
): Promise<boolean> {
  const client = (await dependencies.listClients()).find((item) => item.line_user_id === input.lineUserId && item.line_link_status === "LINKED");
  if (!client) return false;
  return dependencies.updateLineLinkClient({
    client: {
      ...client,
      line_display_name: sheetSafeDisplayName(input.displayName),
      line_picture_url: input.pictureUrl,
      updated_at: new Date(input.now).toISOString(),
    },
    expectedClient: client,
  });
}
