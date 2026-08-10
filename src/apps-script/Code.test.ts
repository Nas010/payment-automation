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
  getSheet: () => { getName: () => string };
  getRow: () => number;
};

const legacyClientHeaders = ["client_id", "active", "client_name", "line_user_id", "line_display_name", "package_name", "payment_type", "total_price_thb", "installment_count", "interval_months", "first_due_date", "default_amount_thb", "billing_frequency", "next_due_date", "notes", "created_at", "updated_at"];

function loadScriptWithDashboard(values: Record<string, unknown>, clientHeaders: unknown[] = [...legacyClientHeaders], clientColumnCount = clientHeaders.length, clientRows: unknown[][] = []) {
  const clientWrites: Array<{ row: number; values: unknown[][] }> = [];
  const clientCellWrites: Array<{ row: number; column: number; values: unknown[][] }> = [];
  const auditRows: unknown[][] = [];
  const alerts: string[] = [];
  const menuNames: string[] = [];
  const menuItems: Array<{ label: string; callback: string }> = [];
  const columnExpansions: Array<{ after: number; count: number }> = [];
  const headerWrites: Array<{ column: number; value: unknown }> = [];
  const clientSheet = {
    getMaxColumns: () => clientColumnCount,
    insertColumnsAfter: (after: number, count: number) => {
      columnExpansions.push({ after, count });
      clientColumnCount += count;
    },
    getLastRow: () => 1000,
    getRange(row: number, column?: number, numRows?: number, numColumns?: number): Range {
      return range({
        getValues: () => {
          if (row === 1) return [Array.from({ length: numColumns ?? clientHeaders.length }, (_, index) => clientHeaders[index] ?? "")];
          if (row === 2 && column === 1 && numRows === 999 && numColumns === 1) return Array.from({ length: 999 }, (_, index) => [clientRows[index]?.[0] ?? ""]);
          if (row === 2 && column === 1 && numColumns === clientHeaders.length && (numRows ?? 1) > 1) return Array.from({ length: numRows ?? 0 }, (_, index) => clientRows[index] ?? []);
          if (row >= 2 && column === 1 && numColumns === clientHeaders.length) return [clientRows[row - 2] ?? []];
          return [];
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
          if (row > 1 && column && column >= 17) clientCellWrites.push({ row, column, values: written });
          return range({});
        },
      });
    },
  };
  const scheduleSheet = { getLastRow: () => 1, getRange: () => range({}) };
  const auditSheet = { appendRow: (row: unknown[]) => { auditRows.push(row); } };
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
  let selectedSheetName = "Dashboard";
  let selectedRow = 1;
  const selectedRange = range({ getSheet: () => ({ getName: () => selectedSheetName }), getRow: () => selectedRow });
  const menu = {
    addItem(label: string, callback: string) { menuItems.push({ label, callback }); return menu; },
    addSeparator() { return menu; },
    addToUi() { return undefined; },
  };
  const context = {
    SpreadsheetApp: { openById: () => book, getActiveRange: () => selectedRange, getUi: () => ({ alert: (message: string) => alerts.push(message), createMenu: (name: string) => { menuNames.push(name); return menu; } }) },
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
  return { context: context as { onOpen: () => void; ensureClientSchema_: () => void; clientDataRows_: () => unknown[]; saveClientFromDashboard: () => void; generateMissingLineLinkCodes: () => unknown; renewLineCodeForSelectedClient: () => unknown; disconnectSelectedClientLine: () => unknown; SpreadsheetApp: { getActiveRange: () => Range } }, select: (sheetName: string, row: number) => { selectedSheetName = sheetName; selectedRow = row; }, clientWrites, clientCellWrites, auditRows, alerts, menuNames, menuItems, columnExpansions, headerWrites };
}

function range(overrides: Partial<Range>): Range {
  const defaultRange: Range = {
    getValue: () => undefined,
    getValues: () => [],
    setValue: () => defaultRange,
    setValues: () => defaultRange,
    clearContent: () => defaultRange,
    setFontColor: () => defaultRange,
    getSheet: () => ({ getName: () => "" }),
    getRow: () => 0,
  };
  return { ...defaultRange, ...overrides };
}

describe("Apps Script client save", () => {
  it("wires all LINE trainer callbacks into Coaching Payments menu", () => {
    const { context, menuNames, menuItems } = loadScriptWithDashboard({});

    context.onOpen();

    expect(menuNames).toEqual(["Coaching Payments"]);
    expect(menuItems).toEqual(expect.arrayContaining([
      { label: "Generate missing LINE link codes", callback: "generateMissingLineLinkCodes" },
      { label: "Renew LINE code for selected client", callback: "renewLineCodeForSelectedClient" },
      { label: "Disconnect selected client's LINE", callback: "disconnectSelectedClientLine" },
    ]));
  });

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

  it("expands legacy client grids before accessing LINE-link header columns", () => {
    const { context, columnExpansions } = loadScriptWithDashboard({}, [...legacyClientHeaders], 17);

    context.ensureClientSchema_();

    expect(columnExpansions).toEqual([{ after: 17, count: 6 }]);
  });

  it("preserves false and zero client header cells", () => {
    const { context, headerWrites } = loadScriptWithDashboard({}, [...legacyClientHeaders, false, 0], 23);

    context.ensureClientSchema_();

    expect(headerWrites).not.toContainEqual({ column: 18, value: "line_link_code" });
    expect(headerWrites).not.toContainEqual({ column: 19, value: "line_link_code_expires_at" });
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

  it("creates Dashboard clients with blank mappings and an active seven-day code instruction", () => {
    const { context, clientWrites } = loadScriptWithDashboard({
      B4: "Nas", E4: "Umanual", B5: "Manual name", E5: "Test package", B6: "ONE_TIME",
      E6: new Date("2026-08-11T00:00:00"), B7: 100000, E7: 1, B8: 0, E8: "",
    });

    context.saveClientFromDashboard();

    const saved = clientWrites[0]?.values[0] ?? [];
    expect(saved.slice(3, 5)).toEqual(["", ""]);
    expect(saved[17]).toMatch(/^[A-F0-9]{10}$/);
    expect(saved[19]).toBe("CODE_ACTIVE");
    expect(String(saved[21])).toContain(`LINK ${saved[17]}`);
    const duration = new Date(String(saved[18])).getTime() - new Date(saved[15] as Date).getTime();
    expect(duration).toBeGreaterThanOrEqual(7 * 24 * 60 * 60 * 1000 - 1000);
    expect(duration).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000);
  });

  it("reports generated, active, linked, and failed client codes", () => {
    const rows = [
      ["created", true, "Created", "", "", "PT", "ONE_TIME", 1000, 1, 0, new Date(), 1000, "MANUAL", new Date(), "", new Date(), new Date(), "", "", "", "", "", ""],
      ["active", true, "Active", "", "", "PT", "ONE_TIME", 1000, 1, 0, new Date(), 1000, "MANUAL", new Date(), "", new Date(), new Date(), "ABCDEF0123", new Date("2099-01-01"), "CODE_ACTIVE", "", "", ""],
      ["linked", true, "Linked", "Uexisting", "Existing", "PT", "ONE_TIME", 1000, 1, 0, new Date(), 1000, "MANUAL", new Date(), "", new Date(), new Date(), "", "", "LINKED", new Date(), "", ""],
    ];
    const { context, clientCellWrites, auditRows } = loadScriptWithDashboard({}, undefined, undefined, rows);

    context.ensureClientSchema_();
    expect(context.clientDataRows_()).toHaveLength(3);
    expect(context.generateMissingLineLinkCodes()).toMatchObject({ created: ["created"], alreadyActive: ["active"], alreadyLinked: ["linked"], failed: [] });
    expect(clientCellWrites).toHaveLength(1);
    expect(clientCellWrites[0]).toMatchObject({ row: 2, column: 17, values: [[expect.any(Date), expect.any(String), expect.any(Date), "CODE_ACTIVE", "", expect.any(String), ""]] });
    expect(auditRows[0]?.[3]).toBe("LINE_LINK_CODE_CREATED");
  });

  it("rejects header and non-Clients selections before selected-client operations", () => {
    const { context, select, alerts } = loadScriptWithDashboard({});

    context.renewLineCodeForSelectedClient();
    select("Clients", 1);
    context.disconnectSelectedClientLine();

    expect(alerts).toEqual(["Select a client data row in Clients (row 2 or later).", "Select a client data row in Clients (row 2 or later)."]);
  });

  it("renews an unlinked selected client without replacing its mapping fields", () => {
    const rows = [["client_1", true, "Nisa", "", "", "PT", "ONE_TIME", 1000, 1, 0, new Date(), 1000, "MANUAL", new Date(), "", new Date(), new Date(), "ABCDEF0123", new Date("2099-01-01"), "CODE_ACTIVE", "", "old message", ""]];
    const { context, select, clientCellWrites, auditRows } = loadScriptWithDashboard({}, undefined, undefined, rows);
    select("Clients", 2);

    expect(context.renewLineCodeForSelectedClient()).toMatchObject({ clientId: "client_1", code: "1111111111", status: "CODE_ACTIVE" });
    expect(clientCellWrites[0]).toMatchObject({ row: 2, column: 17, values: [[expect.any(Date), "1111111111", expect.any(Date), "CODE_ACTIVE", "", expect.stringContaining("LINK 1111111111"), ""]] });
    expect(auditRows[0]?.[3]).toBe("LINE_LINK_CODE_RENEWED");
  });

  it("refuses selected renewal when a different LINE user is already mapped", () => {
    const rows = [["client_1", true, "Nisa", "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "Nisa LINE", "PT", "ONE_TIME", 1000, 1, 0, new Date(), 1000, "MANUAL", new Date(), "", new Date(), new Date(), "ABCDEF0123", new Date("2099-01-01"), "LINKED", new Date(), "", ""]];
    const { context, select, clientWrites, auditRows, alerts } = loadScriptWithDashboard({}, undefined, undefined, rows);
    select("Clients", 2);

    expect(context.renewLineCodeForSelectedClient()).toBeNull();
    expect(clientWrites).toEqual([]);
    expect(auditRows).toEqual([]);
    expect(alerts).toContain("Cannot renew while selected client has a linked LINE user. Disconnect first.");
  });

  it("disconnects a selected client by clearing its mapping and auditing the event", () => {
    const rows = [["client_1", true, "Nisa", "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "Nisa LINE", "PT", "ONE_TIME", 1000, 1, 0, new Date(), 1000, "MANUAL", new Date(), "", new Date(), new Date(), "", "", "LINKED", new Date(), "", ""]];
    const { context, select, clientWrites, auditRows } = loadScriptWithDashboard({}, undefined, undefined, rows);
    select("Clients", 2);

    expect(context.disconnectSelectedClientLine()).toBe(true);
    expect(clientWrites).toContainEqual({ row: 2, values: [[expect.any(Date), "", "", "", "", "", ""]] });
    expect(clientWrites).toContainEqual({ row: 2, values: [["", ""]] });
    expect(auditRows[0]?.[3]).toBe("LINE_LINK_DISCONNECTED");
  });
});
