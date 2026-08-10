import { MinusIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import type { DashboardComparison } from "@/lib/admin/dashboard-metrics";

export function MetricTrend({ comparison, label, delta }: { comparison: DashboardComparison | null; label: string; delta: string }) {
  if (!comparison) return null;

  const presentation = comparison.delta > 0
    ? { Icon: TrendingUpIcon, verb: "increased", className: "text-positive" }
    : comparison.delta < 0
      ? { Icon: TrendingDownIcon, verb: "decreased", className: "text-destructive" }
      : { Icon: MinusIcon, verb: "was unchanged", className: "text-muted-foreground" };
  const change = Math.abs(comparison.delta);
  const ariaLabel = comparison.delta === 0
    ? `${label} was unchanged from last month`
    : `${label} ${presentation.verb} by ${change} from last month`;
  const visibleDelta = delta;

  return <span aria-label={ariaLabel} className={`inline-flex items-center gap-1 text-xs font-medium ${presentation.className}`}><presentation.Icon aria-hidden className="size-4" /><span>{visibleDelta}</span></span>;
}
