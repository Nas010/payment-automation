import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { PAYMENT_HEADERS, SCHEDULE_HEADERS } from "@/lib/sheets/records";

type Range = {
  getValue: () => unknown;
  getValues: () => unknown[][];
  getDisplayValues: () => string[][];
  setValue: (value: unknown) => Range;
  setValues: (values: unknown[][]) => Range;
  clearContent: () => Range;
  setFontColor: (color: string) => Range;
  getSheet: () => { getName: () => string };
  getRow: () => number;
};

const legacyClientHeaders = ["client_id", "active", "client_name", "line_user_id", "line_display_name", "package_name", "payment_type", "total_price_thb", "installment_count", "interval_months", "first_due_date", "default_amount_thb", "billing_frequency", "next_due_date", "notes", "created_at", "updated_at"];

function loadScriptWithDashboard(values: Record<string, unknown>, clientHeaders: unknown[] = [...legacyClientHeaders], clientColumnCount = clientHeaders.length, clientRows: unknown[][] = [], uuidValues = ["11111111-1111-1111-1111-111111111111"], namedRangeNames: string[] = [], triggerHandlers: string[] = [], automation: { scheduleRows?: unknown[][] } = {}) {
  const clientWrites: Array<{ row: number; values: unknown[][] }> = [];
  const clientCellWrites: Array<{ row: number; column: number; values: unknown[][] }> = [];
  const auditRows: unknown[][] = [];
  const alerts: string[] = [];
  const menuNames: string[] = [];
  const menuItems: Array<{ label: string; callback: string }> = [];
  const columnExpansions: Array<{ after: number; count: number }> = [];
  const headerWrites: Array<{ column: number; value: unknown }> = [];
  const releasedReservationNames: string[] = [];
  const namedRanges = new Set(namedRangeNames);
  const lineBatchRequests: Array<{ url: string; options: { payload?: string } }> = [];
  const deletedTriggerHandlers: string[] = [];
  const paymentRows: unknown[][] = [];
  const scheduleWrites: Array<{ row: number; column: number; values: unknown[][] }> = [];
  const clientSheet = {
    getSheetId: () => 9,
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
        getDisplayValues: () => {
          if (row >= 2 && column === 1 && numColumns === clientHeaders.length) return Array.from({ length: numRows ?? 1 }, (_, index) => clientRows[row - 2 + index]?.map((value) => String(value ?? "")) ?? []);
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
  const scheduleRows = automation.scheduleRows ?? [];
  const scheduleSheet = {
    getLastRow: () => Math.max(1, scheduleRows.length),
    getDataRange: () => range({ getValues: () => scheduleRows }),
    getRange: (row: number, column = 1) => range({
      setValues: (written) => { scheduleWrites.push({ row, column, values: written }); return range({}); },
      setValue: (value) => { scheduleWrites.push({ row, column, values: [[value]] }); return range({}); },
    }),
  };
  const paymentsSheet = { appendRow: (row: unknown[]) => { paymentRows.push(row); } };
  const auditSheet = { appendRow: (row: unknown[]) => { auditRows.push(row); } };
  const settingsSheet = {
    getRange: (address: string) => range({
      getValues: () => address === "A2:B"
        ? [["production_base_url", "https://pay.example"]]
        : [["Test package", 100000, "ONE_TIME", 1, 0, true]],
    }),
  };
  const dashboardSheet = {
    getRange(cell: string): Range {
      return range({ getValue: () => values[cell] });
    },
  };
  const book = {
    getSheetByName(name: string) {
      return ({ Dashboard: dashboardSheet, Clients: clientSheet, Payments: paymentsSheet, Settings: settingsSheet, "Installment Schedule": scheduleSheet, "Audit Log": auditSheet } as Record<string, unknown>)[name];
    },
    getNamedRanges() {
      return [...namedRanges].map((name) => ({ getName: () => name, remove: () => { releasedReservationNames.push(name); namedRanges.delete(name); } }));
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
  let uuidIndex = 0;
  const context = {
    SpreadsheetApp: { openById: () => book, getActiveRange: () => selectedRange, getUi: () => ({ alert: (message: string) => alerts.push(message), createMenu: (name: string) => { menuNames.push(name); return menu; } }) },
    Utilities: {
      getUuid: () => uuidValues[Math.min(uuidIndex++, uuidValues.length - 1)],
      formatDate: (date: Date, _timezone: string, format: string) => format === "yyyy-MM-dd"
        ? `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`
        : `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`,
      DigestAlgorithm: { SHA_256: "SHA_256" },
      Charset: { UTF_8: "UTF_8" },
      computeDigest: (_algorithm: string, value: string) => Array.from(createHash("sha256").update(value).digest()).map((byte) => byte > 127 ? byte - 256 : byte),
    },
    ScriptApp: {
      getOAuthToken: () => "script-token",
      getProjectTriggers: () => triggerHandlers.map((handler) => ({ getHandlerFunction: () => handler })),
      deleteTrigger: (trigger: { getHandlerFunction: () => string }) => deletedTriggerHandlers.push(trigger.getHandlerFunction()),
    },
    UrlFetchApp: {
      fetch: (url: string, options: { payload?: string }) => {
        lineBatchRequests.push({ url, options });
        if (url.includes("fields=namedRanges")) return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ namedRanges: [...namedRanges].map((name, index) => ({ name, namedRangeId: `range_${index + 1}` })) }) };
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({}) };
      },
    },
    Date,
    JSON,
    Math,
    Array,
    Object,
    String,
    Number,
    Session: { getScriptTimeZone: () => "Asia/Bangkok" },
  };
  vm.runInNewContext(readFileSync("apps-script/Code.gs", "utf8"), context);
  return { context: context as { onOpen: () => void; ensureClientSchema_: () => void; clientDataRows_: () => unknown[]; saveClientFromDashboard: () => void; generateDuePaymentLinks: () => number; generateMissingLineLinkCodes: () => unknown; renewLineCodeForSelectedClient: () => unknown; disconnectSelectedClientLine: () => unknown; removeLegacyDailyPaymentScheduler: () => unknown; SpreadsheetApp: { getActiveRange: () => Range } }, select: (sheetName: string, row: number) => { selectedSheetName = sheetName; selectedRow = row; }, clientWrites, clientCellWrites, paymentRows, scheduleWrites, auditRows, alerts, menuNames, menuItems, columnExpansions, headerWrites, releasedReservationNames, lineBatchRequests, deletedTriggerHandlers };
}

function range(overrides: Partial<Range>): Range {
  const defaultRange: Range = {
    getValue: () => undefined,
    getValues: () => [],
    getDisplayValues: () => [],
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
  it("manually generates a legacy 30-cell Payments row aligned to the TypeScript header prefix", () => {
    const dueDate = new Date("2020-08-11T00:00:00.000Z");
    const scheduleRow = ["schedule_1", "client_1", "Nisa", "", "", "PT", "INSTALLMENTS", 1, 3, 1500, dueDate, "SCHEDULED", "", "", "", "notes", dueDate, dueDate];
    const { context, paymentRows, scheduleWrites } = loadScriptWithDashboard({}, undefined, undefined, undefined, [
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      "cccccccc-cccc-cccc-cccc-cccccccccccc",
    ], undefined, undefined, { scheduleRows: [SCHEDULE_HEADERS, scheduleRow] });

    expect(context.generateDuePaymentLinks()).toBe(1);
    expect(paymentRows).toHaveLength(1);
    const row = paymentRows[0] ?? [];
    const legacyHeaders = PAYMENT_HEADERS.slice(0, 30);
    expect(PAYMENT_HEADERS.slice(0, row.length)).toEqual(legacyHeaders);
    expect(row).toHaveLength(legacyHeaders.length);
    expect(Object.fromEntries(legacyHeaders.map((header, index) => [header, row[index]]))).toMatchObject({
      payment_id: "pay_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      client_id: "client_1",
      client_name: "Nisa",
      period: "2020-08",
      amount_thb: 1500,
      due_date: "2020-08-11",
      public_token: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbcccccccccccccccccccccccccccccccc",
      payment_url: "https://pay.example/p/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbcccccccccccccccccccccccccccccccc",
      status: "PENDING",
      line_message: "",
      qr_payload_hash: "",
    });
    expect(row[legacyHeaders.indexOf("updated_at")]).toBeInstanceOf(Date);
    expect(scheduleWrites).toEqual(expect.arrayContaining([
      { row: 2, column: 12, values: [["GENERATED", expect.any(Date), "pay_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "https://pay.example/p/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbcccccccccccccccccccccccccccccccc"]] },
      { row: 2, column: 18, values: [[expect.any(Date)]] },
    ]));
  });

  it("keeps manual generation while replacing scheduler installation with targeted legacy removal", () => {
    const { context, menuItems } = loadScriptWithDashboard({});

    context.onOpen();

    expect(menuItems).toContainEqual({ label: "Generate links due today", callback: "generateDuePaymentLinks" });
    expect(menuItems).toContainEqual({ label: "Remove legacy daily payment scheduler", callback: "removeLegacyDailyPaymentScheduler" });
    expect(menuItems).not.toContainEqual({ label: "Install 09:00 daily scheduler", callback: "installDailyScheduler" });
  });

  it("deletes only legacy payment-generation triggers", () => {
    const { context, deletedTriggerHandlers } = loadScriptWithDashboard({}, undefined, undefined, undefined, undefined, undefined, ["generateDuePaymentLinks", "onOpen", "onEdit", "otherAutomation"]);

    context.removeLegacyDailyPaymentScheduler();

    expect(deletedTriggerHandlers).toEqual(["generateDuePaymentLinks"]);
  });

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

  it("retries Dashboard code generation when a current Clients row already uses the deterministic candidate", () => {
    const rows = [["client_existing", true, "Existing", "", "", "PT", "ONE_TIME", 1000, 1, 0, new Date(), 1000, "MANUAL", new Date(), "", new Date(), new Date(), "1111111111", new Date("2099-01-01"), "CODE_ACTIVE", "", "", ""]];
    const { context, clientWrites } = loadScriptWithDashboard({
      B4: "Nas", E5: "Test package", B6: "ONE_TIME", E6: new Date("2026-08-11T00:00:00"), B7: 100000, E7: 1, B8: 0, E8: "",
    }, undefined, undefined, rows, ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"]);

    context.saveClientFromDashboard();

    expect(clientWrites[0]?.values[0]?.[17]).toBe("2222222222");
  });

  it("reports generated, active, linked, and failed client codes", () => {
    const rows = [
      ["created", true, "Created", "", "", "PT", "ONE_TIME", 1000, 1, 0, new Date(), 1000, "MANUAL", new Date(), "", new Date(), new Date(), "", "", "", "", "", ""],
      ["active", true, "Active", "", "", "PT", "ONE_TIME", 1000, 1, 0, new Date(), 1000, "MANUAL", new Date(), "", new Date(), new Date(), "ABCDEF0123", new Date("2099-01-01"), "CODE_ACTIVE", "", "", ""],
      ["linked", true, "Linked", "Uexisting", "Existing", "PT", "ONE_TIME", 1000, 1, 0, new Date(), 1000, "MANUAL", new Date(), "", new Date(), new Date(), "", "", "LINKED", new Date(), "", ""],
    ];
    const { context, clientCellWrites, auditRows, lineBatchRequests } = loadScriptWithDashboard({}, undefined, undefined, rows);

    context.ensureClientSchema_();
    expect(context.clientDataRows_()).toHaveLength(3);
    expect(context.generateMissingLineLinkCodes()).toMatchObject({ created: ["created"], alreadyActive: ["active"], alreadyLinked: ["linked"], failed: [] });
    expect(clientCellWrites).toEqual([]);
    const batch = JSON.parse(lineBatchRequests[0]?.options.payload ?? "{}");
    expect(batch.requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ addNamedRange: expect.objectContaining({ namedRange: expect.objectContaining({ name: expect.stringMatching(/^line_link_state_[a-f0-9]{64}$/) }) }) }),
      expect.objectContaining({ updateCells: expect.objectContaining({ range: expect.objectContaining({ startColumnIndex: 16, endColumnIndex: 23 }) }) }),
    ]));
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
    const { context, select, clientCellWrites, auditRows, lineBatchRequests } = loadScriptWithDashboard({}, undefined, undefined, rows);
    select("Clients", 2);

    expect(context.renewLineCodeForSelectedClient()).toMatchObject({ clientId: "client_1", code: "1111111111", status: "CODE_ACTIVE" });
    expect(clientCellWrites).toEqual([]);
    expect(auditRows[0]?.[3]).toBe("LINE_LINK_CODE_RENEWED");
    const batch = JSON.parse(lineBatchRequests.at(-1)?.options.payload ?? "{}");
    expect(batch.requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ addNamedRange: expect.objectContaining({ namedRange: expect.objectContaining({ name: expect.stringMatching(/^line_link_state_[a-f0-9]{64}$/) }) }) }),
      expect.objectContaining({ updateCells: expect.any(Object) }),
    ]));
  });

  it("uses the server-identical state hash over ordered string fields before renewal", () => {
    const rows = [["client_1", "TRUE", "Nisa", "", "", "PT", "ONE_TIME", "1000", "1", "0", "2026-08-10", "1000", "MANUAL", "2026-08-10", "", "2026-08-10T00:00:00.000Z", "2026-08-10T12:00:00.000Z", "ABCDEF0123", "2099-01-01T00:00:00.000Z", "CODE_ACTIVE", "", "old message", ""]];
    const { context, select, lineBatchRequests } = loadScriptWithDashboard({}, undefined, undefined, rows);
    const state = ["client_1", "TRUE", "", "", "ABCDEF0123", "2099-01-01T00:00:00.000Z", "CODE_ACTIVE", "", "old message", "", "2026-08-10T12:00:00.000Z"];
    const expected = `line_link_state_${createHash("sha256").update(JSON.stringify(state)).digest("hex")}`;
    select("Clients", 2);

    context.renewLineCodeForSelectedClient();

    const batch = JSON.parse(lineBatchRequests.at(-1)?.options.payload ?? "{}");
    expect(batch.requests[0]?.addNamedRange?.namedRange?.name).toBe(expected);
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
    const userId = "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const rows = [["client_1", true, "Nisa", userId, "Nisa LINE", "PT", "ONE_TIME", 1000, 1, 0, new Date(), 1000, "MANUAL", new Date(), "", new Date(), new Date(), "", "", "LINKED", new Date(), "", ""]];
    const reservation = `line_link_user_${createHash("sha256").update(userId).digest("hex")}`;
    const { context, select, clientWrites, auditRows, releasedReservationNames, lineBatchRequests } = loadScriptWithDashboard({}, undefined, undefined, rows, undefined, [reservation]);
    select("Clients", 2);

    expect(context.disconnectSelectedClientLine()).toBe(true);
    expect(clientWrites).toEqual([]);
    expect(releasedReservationNames).toEqual([]);
    const batch = JSON.parse(lineBatchRequests.at(-1)?.options.payload ?? "{}");
    expect(batch.requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ addNamedRange: expect.objectContaining({ namedRange: expect.objectContaining({ name: expect.stringMatching(/^line_link_state_[a-f0-9]{64}$/) }) }) }),
      expect.objectContaining({ updateCells: expect.objectContaining({ range: expect.objectContaining({ startColumnIndex: 3, endColumnIndex: 5 }) }) }),
      { deleteNamedRange: { namedRangeId: "range_1" } },
    ]));
    expect(auditRows[0]?.[3]).toBe("LINE_LINK_DISCONNECTED");
  });
});
