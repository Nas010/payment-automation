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

const legacyClientHeaders = ["client_id", "active", "client_name", "line_user_id", "line_display_name", "package_name", "payment_type", "total_price_thb", "installment_count", "interval_months", "first_due_date", "default_amount_thb", "billing_frequency", "next_due_date", "notes", "created_at", "updated_at"];

function loadScriptWithDashboard(values: Record<string, unknown>, clientHeaders = [...legacyClientHeaders]) {
  const clientWrites: Array<{ row: number; values: unknown[][] }> = [];
  const headerWrites: Array<{ column: number; value: unknown }> = [];
  const clientSheet = {
    getLastRow: () => 1000,
    getRange(row: number, column?: number, numRows?: number, numColumns?: number): Range {
      return range({
        getValues: () => {
          if (row === 1) return [Array.from({ length: numColumns ?? clientHeaders.length }, (_, index) => clientHeaders[index] ?? "")];
          return row === 2 && column === 1 && numRows === 999 && numColumns === 1 ? Array.from({ length: 999 }, () => [""]) : [];
        },
        setValue: (value) => {
          if (row === 1 && column) {
            clientHeaders[column - 1] = String(value);
            headerWrites.push({ column, value });
          }
          return range({});
        },
        setValues: (written) => {
          if (row > 1) clientWrites.push({ row, values: written });
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
  return { context: context as { ensureClientSchema_: () => void; saveClientFromDashboard: () => void }, clientWrites, headerWrites };
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
  it("fills only blank LINE-link client headers", () => {
    const { context, headerWrites } = loadScriptWithDashboard({}, [...legacyClientHeaders, "line_link_code", "", "legacy status"]);

    context.ensureClientSchema_();

    expect(headerWrites).toEqual([
      { column: 19, value: "line_link_code_expires_at" },
      { column: 21, value: "line_linked_at" },
      { column: 22, value: "line_link_message" },
      { column: 23, value: "line_link_error" },
    ]);
  });

  it("writes a new client into first blank client-ID row when unused rows contain FALSE", () => {
    const { context, clientWrites } = loadScriptWithDashboard({
      B4: "Nas", E4: "line_1", B5: "Nas", E5: "Test package", B6: "ONE_TIME",
      E6: new Date("2026-08-11T00:00:00"), B7: 100000, E7: 1, B8: 0, E8: "",
    });

    context.saveClientFromDashboard();

    expect(clientWrites).toHaveLength(1);
    expect(clientWrites[0]?.row).toBe(2);
    expect(clientWrites[0]?.values[0]?.slice(1, 3)).toEqual([true, "Nas"]);
    expect(clientWrites[0]?.values[0]).toHaveLength(23);
  });
});
