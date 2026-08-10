import { MinusIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import type { DashboardComparison } from "@/lib/admin/dashboard-metrics";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function MetricTrend({ comparison, label, current, previous, delta }: { comparison: DashboardComparison | null; label: string; current: string; previous: string; delta: string }) {
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

  return <Tooltip><TooltipTrigger render={<span aria-label={ariaLabel} className={`flex size-5 items-center justify-center rounded-sm [&>svg]:size-4 ${presentation.className}`} tabIndex={0} />}><presentation.Icon aria-hidden /></TooltipTrigger><TooltipContent>{label}: {current} now, {previous} last month. Change: {delta}.</TooltipContent></Tooltip>;
}
