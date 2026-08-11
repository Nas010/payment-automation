import type { LineLinkStatus } from "./line-link-actions";

export function lineLinkStatus(client: { line_user_id: string; line_link_status: string; line_link_code_expires_at: string }): LineLinkStatus {
  if (client.line_user_id.trim()) return "LINKED";
  if (client.line_link_status === "REVIEW") return "REVIEW";
  if (client.line_link_status === "CODE_ACTIVE") return new Date(client.line_link_code_expires_at).getTime() > Date.now() ? "CODE_ACTIVE" : "EXPIRED";
  return "UNLINKED";
}
