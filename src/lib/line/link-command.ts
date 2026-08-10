import { normalizeLineLinkCode } from "./link-code";

const LINK_COMMAND_PATTERN = /^LINK\s+([A-F0-9]{10})$/;

export function parseLineLinkCommand(text: string): string | null {
  const match = text.trim().toUpperCase().match(LINK_COMMAND_PATTERN);
  return match ? normalizeLineLinkCode(match[1]) : null;
}
