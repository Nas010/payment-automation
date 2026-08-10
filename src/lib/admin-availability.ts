import { requiredConfiguration } from "@/lib/config";

export function adminWorkbookAvailability(environment: Record<string, string | undefined> = process.env): { available: boolean; missing: string[] } {
  const missing = requiredConfiguration(environment);
  return { available: missing.length === 0, missing };
}
