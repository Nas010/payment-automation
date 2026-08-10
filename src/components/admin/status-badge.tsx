import { CheckCircle2Icon, CircleAlertIcon, Clock3Icon, FlagIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function StatusBadge({ status }: { status: string }) {
  if (status === "AUTO_RECORDED" || status === "MANUAL_CONFIRMED" || status === "PAID") return <Badge><CheckCircle2Icon data-icon="inline-start" />{status.replaceAll("_", " ")}</Badge>;
  if (status === "REVIEW") return <Badge variant="secondary"><CircleAlertIcon data-icon="inline-start" />Needs review</Badge>;
  if (status === "FLAGGED" || status === "OVERDUE") return <Badge variant="destructive"><FlagIcon data-icon="inline-start" />{status.replaceAll("_", " ")}</Badge>;
  return <Badge variant="outline"><Clock3Icon data-icon="inline-start" />{status.replaceAll("_", " ")}</Badge>;
}
