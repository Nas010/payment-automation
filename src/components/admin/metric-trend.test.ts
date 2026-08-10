/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { createElement, type ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal("React", React);

type TrendProps = {
  comparison: { current: number; previous: number; delta: number } | null;
  label: string;
  delta: string;
};

async function loadMetricTrend(): Promise<ComponentType<TrendProps> | null> {
  const loader = import.meta.glob("./metric-trend.tsx")["./metric-trend.tsx"];
  if (!loader) return null;
  const loadedModule = await loader();
  return (loadedModule as Record<string, unknown>).MetricTrend as ComponentType<TrendProps>;
}

function renderTrend(MetricTrend: ComponentType<TrendProps>, props: TrendProps) {
  render(createElement(MetricTrend, props));
}

afterEach(cleanup);

describe("MetricTrend", () => {
  it("labels an upward active-client trend accessibly", async () => {
    const MetricTrend = await loadMetricTrend();
    expect(MetricTrend).toBeTypeOf("function");
    if (!MetricTrend) return;

    renderTrend(MetricTrend, { comparison: { current: 5, previous: 3, delta: 2 }, label: "Active clients", delta: "2" });

    expect(screen.getByLabelText("Active clients increased by 2 from last month")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("does not render a trend icon without comparison data", async () => {
    const MetricTrend = await loadMetricTrend();
    expect(MetricTrend).toBeTypeOf("function");
    if (!MetricTrend) return;

    renderTrend(MetricTrend, { comparison: null, label: "Active clients", delta: "—" });

    expect(screen.queryByLabelText(/Active clients/)).toBeNull();
  });

  it("labels downward trends as decreases", async () => {
    const MetricTrend = await loadMetricTrend();
    expect(MetricTrend).toBeTypeOf("function");
    if (!MetricTrend) return;

    renderTrend(MetricTrend, { comparison: { current: 3, previous: 5, delta: -2 }, label: "Active clients", delta: "2" });

    expect(screen.getByLabelText("Active clients decreased by 2 from last month")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });
});
