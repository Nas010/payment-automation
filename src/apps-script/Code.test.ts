import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

type Range = {
  getValue: () => unknown;
  getValues: () => unknown[][];
  setValue: (value: unknown) => Range;
  setValues: (values: unknown[][]) => Range;
  clearContent: () => Range;
  setFontColor: (color: string) => Range;
};

function loadScriptWithDashboard(values: Record<string, unknown>) {
  const clientWrites: Array<{ row: number; values: unknown[][] }> = [];
  const clientSheet = {
    getLastRow: () => 1000,
    getRange(row: number, column?: number, numRows?: number, numColumns?: number): Range {
      return range({
        getValues: () => row === 2 && column === 1 && numRows === 999 && numColumns === 1
          ? Array.from({ length: 999 }, () => [""])
          : [],
        setValues: (written) => {
          clientWrites.push({ row, values: written });
          return range({});
        },
      });
    },
  };
  const scheduleSheet = { getLastRow: () => 1, getRange: () => range({}) };
  const auditSheet = { appendRow: () => undefined };
  const settingsSheet = {
    getRange: () => range({
      getValues: () => [["Test package", 100000, "ONE_TIME", 1, 0, true]],
    }),
  };
  const dashboardSheet = {
    getRange(cell: string): Range {
      return range({ getValue: () => values[cell] });
    },
  };
  const book = {
    getSheetByName(name: string) {
      return ({ Dashboard: dashboardSheet, Clients: clientSheet, Settings: settingsSheet, "Installment Schedule": scheduleSheet, "Audit Log": auditSheet } as Record<string, unknown>)[name];
    },
  };
  const context = {
    SpreadsheetApp: { openById: () => book },
    Utilities: { getUuid: () => "11111111-1111-1111-1111-111111111111" },
    Date,
    JSON,
    Math,
    Array,
    Object,
    String,
    Number,
  };
  vm.runInNewContext(readFileSync("apps-script/Code.gs", "utf8"), context);
  return { context: context as { saveClientFromDashboard: () => void }, clientWrites };
}

function range(overrides: Partial<Range>): Range {
  const defaultRange: Range = {
    getValue: () => undefined,
    getValues: () => [],
    setValue: () => defaultRange,
    setValues: () => defaultRange,
    clearContent: () => defaultRange,
    setFontColor: () => defaultRange,
  };
  return { ...defaultRange, ...overrides };
}

describe("Apps Script client save", () => {
  it("writes a new client into first blank client-ID row when unused rows contain FALSE", () => {
    const { context, clientWrites } = loadScriptWithDashboard({
      B4: "Nas", E4: "line_1", B5: "Nas", E5: "Test package", B6: "ONE_TIME",
      E6: new Date("2026-08-11T00:00:00"), B7: 100000, E7: 1, B8: 0, E8: "",
    });

    context.saveClientFromDashboard();

    expect(clientWrites).toHaveLength(1);
    expect(clientWrites[0]?.row).toBe(2);
    expect(clientWrites[0]?.values[0]?.slice(1, 3)).toEqual([true, "Nas"]);
  });
});
