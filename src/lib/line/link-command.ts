import { normalizeLineLinkCode } from "./link-code";

const LINK_COMMAND_PATTERN = /^LINK ([A-Fa-f0-9]{10})$/;

export function parseLineLinkCommand(text: string): string | null {
  const match = LINK_COMMAND_PATTERN.exec(text);
  return match ? normalizeLineLinkCode(match[1]) : null;
}
