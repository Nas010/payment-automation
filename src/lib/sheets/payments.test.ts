import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentRecord } from "./payments";
import { PAYMENT_HEADERS } from "./records";

const { append, batchUpdate, get, listSchedules, reconcileTerminalPaymentEffects, spreadsheetGet } = vi.hoisted(() => ({ append: vi.fn(), batchUpdate: vi.fn(), get: vi.fn(), listSchedules: vi.fn(), reconcileTerminalPaymentEffects: vi.fn(), spreadsheetGet: vi.fn() }));

vi.mock("./client", () => ({
  getGoogleSheets: () => ({ spreadsheetId: "spreadsheet_1", sheets: { spreadsheets: { get: spreadsheetGet, batchUpdate, values: { append, get } } } }),
}));
vi.mock("./migration", () => ({ ensurePaymentSchema: vi.fn(async () => undefined) }));
vi.mock("./schedules", () => ({ listSchedules }));
vi.mock("@/lib/payments/transition", () => ({ reconcileTerminalPaymentEffects }));

import { paymentStateTokenName, reconcileManualConfirmations, updatePayment, updatePaymentIfUnchanged } from "./payments";

function payment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return { rowNumber: 2, payment_id: "pay_1", client_id: "client_1", client_name: "Nisa", amount_thb: "3000", status: "PENDING", line_slip_expected: "TRUE", line_slip_processing_status: "AWAITING", updated_at: "2026-08-11T00:00:00.000Z", ...overrides } as PaymentRecord;
}

function row(record: PaymentRecord): string[] {
  return [...PAYMENT_HEADERS.map((header) => record[header])].map((value) => value ?? "");
}

function metadata(namedRanges: Array<{ name: string; namedRangeId: string }> = []) {
  return { data: { sheets: [{ properties: { sheetId: 12, title: "Payments" } }], namedRanges } };
}

type SheetRequest = {
  addNamedRange?: { namedRange: { name: string } };
  deleteNamedRange?: { namedRangeId: string };
  updateCells?: { rows: Array<{ values: Array<{ userEnteredValue: { stringValue: string } }> }> };
};

function statefulSheet(initialPayment: PaymentRecord, options: { synchronizeFirstMetadataReads?: boolean; pauseFirstBatch?: boolean; failFirstRepairBatch?: boolean; ambiguouslyApplyFirstRepairBatch?: boolean; ambiguouslyApplyFirstBootstrapBatch?: boolean } = {}) {
  let currentRow = row(initialPayment);
  let tokenSequence = 0;
  const tokens = new Map<string, string>();
  const batchRequests: SheetRequest[][] = [];
  let metadataReads = 0;
  let releaseMetadataReads: (() => void) | undefined;
  const metadataGate = new Promise<void>((resolve) => { releaseMetadataReads = resolve; });
  let releaseFirstBatch: (() => void) | undefined;
  const firstBatchGate = new Promise<void>((resolve) => { releaseFirstBatch = resolve; });
  let markFirstBatchStarted: (() => void) | undefined;
  const firstBatchStarted = new Promise<void>((resolve) => { markFirstBatchStarted = resolve; });
  let batchCalls = 0;
  let repairBatchFailed = false;
  let repairBatchAppliedAmbiguously = false;

  get.mockImplementation(async () => ({ data: { values: [[...currentRow]] } }));
  spreadsheetGet.mockImplementation(async () => {
    const snapshot = metadata([...tokens].map(([name, namedRangeId]) => ({ name, namedRangeId })));
    metadataReads += 1;
    if (options.synchronizeFirstMetadataReads && metadataReads <= 2) {
      if (metadataReads === 2) releaseMetadataReads?.();
      await metadataGate;
    }
    return snapshot;
  });
  batchUpdate.mockImplementation(async ({ requestBody }: { requestBody: { requests: SheetRequest[] } }) => {
    batchRequests.push(requestBody.requests);
    batchCalls += 1;
    const batchCall = batchCalls;
    const isRepairBatch = requestBody.requests.some((request) => request.deleteNamedRange) && !requestBody.requests.some((request) => request.updateCells);
    if (options.pauseFirstBatch && batchCall === 1) {
      markFirstBatchStarted?.();
      await firstBatchGate;
    }
    if (options.failFirstRepairBatch && !repairBatchFailed && isRepairBatch) {
      repairBatchFailed = true;
      throw Object.assign(new Error("DeleteNamedRange target does not exist"), { response: { status: 400 } });
    }
    const nextTokens = new Map(tokens);
    let nextRow = [...currentRow];
    for (const request of requestBody.requests) {
      if (request.addNamedRange) {
        const name = request.addNamedRange.namedRange.name;
        if (nextTokens.has(name)) throw Object.assign(new Error("Named range already exists"), { response: { status: 400 } });
        nextTokens.set(name, `token_${++tokenSequence}`);
      }
      if (request.deleteNamedRange) {
        const entry = [...nextTokens].find(([, namedRangeId]) => namedRangeId === request.deleteNamedRange?.namedRangeId);
        if (!entry) throw Object.assign(new Error("DeleteNamedRange target does not exist"), { response: { status: 400 } });
        nextTokens.delete(entry[0]);
      }
      if (request.updateCells) nextRow = request.updateCells.rows[0].values.map((cell) => cell.userEnteredValue.stringValue);
    }
    tokens.clear();
    for (const [name, namedRangeId] of nextTokens) tokens.set(name, namedRangeId);
    currentRow = nextRow;
    if (options.ambiguouslyApplyFirstBootstrapBatch && batchCall === 1 && requestBody.requests.some((request) => request.addNamedRange) && !requestBody.requests.some((request) => request.deleteNamedRange || request.updateCells)) {
      throw new Error("Connection reset after request");
    }
    if (options.ambiguouslyApplyFirstRepairBatch && !repairBatchAppliedAmbiguously && isRepairBatch) {
      repairBatchAppliedAmbiguously = true;
      throw new Error("Connection reset after request");
    }
    return {};
  });

  return {
    batchRequests,
    currentRow: () => currentRow,
    firstBatchStarted,
    releaseFirstBatch: () => releaseFirstBatch?.(),
    seedToken: (record: PaymentRecord) => tokens.set(paymentStateTokenName(record), `token_${++tokenSequence}`),
    tokenNames: () => [...tokens.keys()],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ data: { values: [row(payment())] } });
  spreadsheetGet.mockResolvedValue(metadata([]));
  batchUpdate.mockResolvedValue({});
  append.mockResolvedValue({});
  listSchedules.mockResolvedValue([]);
  reconcileTerminalPaymentEffects.mockResolvedValue(false);
});

describe("updatePaymentIfUnchanged", () => {
  it("refuses a stale expected state after rereading the actual payment row", async () => {
    get.mockResolvedValue({ data: { values: [row(payment({ status: "AUTO_RECORDED", line_slip_expected: "FALSE" }))] } });

    await expect(updatePaymentIfUnchanged({ expectedPayment: payment(), payment: payment({ line_slip_processing_status: "DOWNLOADING" }) })).resolves.toBe(false);
    expect(batchUpdate).not.toHaveBeenCalled();
  });

  it("returns false when concurrent bootstrap wins the identical current-state token", async () => {
    const winningPayment = payment({ line_slip_processing_status: "DOWNLOADING", updated_at: "2026-08-11T01:00:00.000Z" });
    get
      .mockResolvedValueOnce({ data: { values: [row(payment())] } })
      .mockResolvedValue({ data: { values: [row(winningPayment)] } });
    spreadsheetGet
      .mockResolvedValueOnce(metadata([]))
      .mockResolvedValue(metadata([{ name: paymentStateTokenName(winningPayment), namedRangeId: "winner_token" }]));
    batchUpdate.mockRejectedValueOnce(Object.assign(new Error("Named range already exists"), { response: { status: 400 } }));

    await expect(updatePaymentIfUnchanged({ expectedPayment: payment(), payment: payment({ line_slip_processing_status: "DOWNLOADING" }) })).resolves.toBe(false);
    expect(batchUpdate).toHaveBeenCalledOnce();
  });

  it("bootstraps a missing current token then swaps one token and row in one CAS batch", async () => {
    const expectedPayment = payment();
    const nextPayment = payment({ line_slip_processing_status: "DOWNLOADING", updated_at: "2026-08-11T01:00:00.000Z" });
    spreadsheetGet
      .mockResolvedValueOnce(metadata([]))
      .mockResolvedValueOnce(metadata([{ name: paymentStateTokenName(expectedPayment), namedRangeId: "token_1" }]));

    await expect(updatePaymentIfUnchanged({ expectedPayment, payment: nextPayment })).resolves.toBe(true);

    expect(batchUpdate).toHaveBeenNthCalledWith(1, expect.objectContaining({ requestBody: { requests: [expect.objectContaining({ addNamedRange: expect.any(Object) })] } }));
    expect(batchUpdate).toHaveBeenNthCalledWith(2, expect.objectContaining({ requestBody: { requests: expect.arrayContaining([
      { deleteNamedRange: { namedRangeId: "token_1" } },
      expect.objectContaining({ addNamedRange: expect.any(Object) }),
      expect.objectContaining({ updateCells: expect.objectContaining({ range: expect.objectContaining({ sheetId: 12, startRowIndex: 1, endRowIndex: 2, endColumnIndex: 49 }) }) }),
    ]) } }));
  });

  it("repairs a stale token against the actual complete-row state for the next CAS", async () => {
    const initialPayment = payment();
    const nextPayment = payment({ line_slip_processing_status: "DOWNLOADING", updated_at: "2026-08-11T01:00:00.000Z" });
    const sheet = statefulSheet(initialPayment);
    sheet.seedToken(payment({ updated_at: "2026-08-10T23:00:00.000Z" }));

    await expect(updatePaymentIfUnchanged({ expectedPayment: initialPayment, payment: nextPayment })).resolves.toBe(false);
    expect(sheet.currentRow()).toEqual(row(initialPayment));
    expect(sheet.tokenNames()).toEqual([paymentStateTokenName(initialPayment)]);
    await expect(updatePaymentIfUnchanged({ expectedPayment: initialPayment, payment: nextPayment })).resolves.toBe(true);
    expect(sheet.currentRow()).toEqual(row(nextPayment));
    expect(sheet.tokenNames()).toEqual([paymentStateTokenName(nextPayment)]);
  });

  it("generic payment writes replace any existing payment token instead of leaking state reservations", async () => {
    const initialPayment = payment();
    const nextPayment = payment({ line_slip_processing_status: "DOWNLOADING" });
    const sheet = statefulSheet(initialPayment);
    sheet.seedToken(payment({ updated_at: "2026-08-10T23:00:00.000Z" }));

    await updatePayment(nextPayment);

    expect(sheet.currentRow()).toEqual(row(nextPayment));
    expect(sheet.tokenNames()).toEqual([paymentStateTokenName(nextPayment)]);
  });

  it("serializes two generic first writers through one current-state bootstrap token", async () => {
    const initialPayment = payment();
    const firstPayment = payment({ line_slip_processing_status: "DOWNLOADING", updated_at: "2026-08-11T01:00:00.000Z" });
    const secondPayment = payment({ line_slip_processing_status: "FAILED_TRANSIENT", updated_at: "2026-08-11T02:00:00.000Z" });
    const sheet = statefulSheet(initialPayment, { synchronizeFirstMetadataReads: true });

    const results = await Promise.allSettled([updatePayment(firstPayment), updatePayment(secondPayment)]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const winner = results.findIndex((result) => result.status === "fulfilled");
    const winningPayment = [firstPayment, secondPayment][winner];
    expect(sheet.currentRow()).toEqual(row(winningPayment));
    expect(sheet.tokenNames()).toEqual([paymentStateTokenName(winningPayment)]);
    expect(sheet.batchRequests.slice(0, 2)).toEqual([
      [{ addNamedRange: { namedRange: expect.objectContaining({ name: paymentStateTokenName(initialPayment) }) } }],
      [{ addNamedRange: { namedRange: expect.objectContaining({ name: paymentStateTokenName(initialPayment) }) } }],
    ]);
  });

  it("does not let a generic first writer overwrite a concurrent CAS bootstrap winner", async () => {
    const initialPayment = payment();
    const casPayment = payment({ line_slip_processing_status: "DOWNLOADING", updated_at: "2026-08-11T01:00:00.000Z" });
    const genericPayment = payment({ line_slip_processing_status: "FAILED_TRANSIENT", updated_at: "2026-08-11T02:00:00.000Z" });
    const sheet = statefulSheet(initialPayment, { synchronizeFirstMetadataReads: true });

    const [casResult, genericResult] = await Promise.allSettled([
      updatePaymentIfUnchanged({ expectedPayment: initialPayment, payment: casPayment }),
      updatePayment(genericPayment),
    ]);

    expect(casResult).toEqual({ status: "fulfilled", value: true });
    expect(genericResult.status).toBe("rejected");
    expect(sheet.currentRow()).toEqual(row(casPayment));
    expect(sheet.tokenNames()).toEqual([paymentStateTokenName(casPayment)]);
    expect(sheet.batchRequests.slice(0, 2)).toEqual([
      [{ addNamedRange: { namedRange: expect.objectContaining({ name: paymentStateTokenName(initialPayment) }) } }],
      [{ addNamedRange: { namedRange: expect.objectContaining({ name: paymentStateTokenName(initialPayment) }) } }],
    ]);
  });

  it("removes a delayed stale bootstrap after another CAS completes and permits the next CAS", async () => {
    const initialPayment = payment();
    const winningPayment = payment({ line_slip_processing_status: "DOWNLOADING", updated_at: "2026-08-11T01:00:00.000Z" });
    const futurePayment = payment({ line_slip_processing_status: "ANALYZING", updated_at: "2026-08-11T02:00:00.000Z" });
    const sheet = statefulSheet(initialPayment, { pauseFirstBatch: true });

    const delayedAttempt = updatePaymentIfUnchanged({ expectedPayment: initialPayment, payment: payment({ line_slip_processing_status: "FAILED_TRANSIENT" }) });
    await sheet.firstBatchStarted;
    await expect(updatePaymentIfUnchanged({ expectedPayment: initialPayment, payment: winningPayment })).resolves.toBe(true);
    sheet.releaseFirstBatch();

    await expect(delayedAttempt).resolves.toBe(false);
    expect(sheet.currentRow()).toEqual(row(winningPayment));
    expect(sheet.tokenNames()).toEqual([paymentStateTokenName(winningPayment)]);
    await expect(updatePaymentIfUnchanged({ expectedPayment: winningPayment, payment: futurePayment })).resolves.toBe(true);
    expect(sheet.currentRow()).toEqual(row(futurePayment));
    expect(sheet.tokenNames()).toEqual([paymentStateTokenName(futurePayment)]);
  });

  it("retries stale-token cleanup when its first atomic delete conflicts", async () => {
    const currentPayment = payment({ line_slip_processing_status: "DOWNLOADING", updated_at: "2026-08-11T01:00:00.000Z" });
    const nextPayment = payment({ line_slip_processing_status: "ANALYZING", updated_at: "2026-08-11T02:00:00.000Z" });
    const sheet = statefulSheet(currentPayment, { failFirstRepairBatch: true });
    sheet.seedToken(currentPayment);
    sheet.seedToken(payment());

    await expect(updatePaymentIfUnchanged({ expectedPayment: currentPayment, payment: nextPayment })).resolves.toBe(false);
    expect(sheet.currentRow()).toEqual(row(currentPayment));
    expect(sheet.tokenNames()).toEqual([paymentStateTokenName(currentPayment)]);
    await expect(updatePaymentIfUnchanged({ expectedPayment: currentPayment, payment: nextPayment })).resolves.toBe(true);
    expect(sheet.currentRow()).toEqual(row(nextPayment));
    expect(sheet.tokenNames()).toEqual([paymentStateTokenName(nextPayment)]);
  });

  it("re-reads state after an ambiguous repair response before rejecting the CAS", async () => {
    const currentPayment = payment({ line_slip_processing_status: "DOWNLOADING", updated_at: "2026-08-11T01:00:00.000Z" });
    const nextPayment = payment({ line_slip_processing_status: "ANALYZING", updated_at: "2026-08-11T02:00:00.000Z" });
    const sheet = statefulSheet(currentPayment, { ambiguouslyApplyFirstRepairBatch: true });
    sheet.seedToken(payment());

    await expect(updatePaymentIfUnchanged({ expectedPayment: currentPayment, payment: nextPayment })).resolves.toBe(false);
    expect(sheet.currentRow()).toEqual(row(currentPayment));
    expect(sheet.tokenNames()).toEqual([paymentStateTokenName(currentPayment)]);
    await expect(updatePaymentIfUnchanged({ expectedPayment: currentPayment, payment: nextPayment })).resolves.toBe(true);
    expect(sheet.currentRow()).toEqual(row(nextPayment));
    expect(sheet.tokenNames()).toEqual([paymentStateTokenName(nextPayment)]);
  });

  it("cleans an ambiguously applied delayed bootstrap after another CAS completes", async () => {
    const initialPayment = payment();
    const winningPayment = payment({ line_slip_processing_status: "DOWNLOADING", updated_at: "2026-08-11T01:00:00.000Z" });
    const sheet = statefulSheet(initialPayment, { pauseFirstBatch: true, ambiguouslyApplyFirstBootstrapBatch: true });

    const delayedAttempt = updatePaymentIfUnchanged({ expectedPayment: initialPayment, payment: payment({ line_slip_processing_status: "FAILED_TRANSIENT" }) });
    await sheet.firstBatchStarted;
    await expect(updatePaymentIfUnchanged({ expectedPayment: initialPayment, payment: winningPayment })).resolves.toBe(true);
    sheet.releaseFirstBatch();

    await expect(delayedAttempt).rejects.toThrow("Connection reset after request");
    expect(sheet.currentRow()).toEqual(row(winningPayment));
    expect(sheet.tokenNames()).toEqual([paymentStateTokenName(winningPayment)]);
  });
});

describe("reconcileManualConfirmations", () => {
  it("clears LINE slip expectation while reconciling a directly edited manual confirmation", async () => {
    const confirmed = payment({ status: "MANUAL_CONFIRMED", manual_confirmed_at: "", line_slip_expected: "TRUE" });
    get.mockImplementation(async ({ range }: { range: string }) => ({ data: { values: range === "Payments!A:AW" ? [PAYMENT_HEADERS, row(confirmed)] : [row(confirmed)] } }));
    spreadsheetGet
      .mockResolvedValueOnce(metadata([]))
      .mockResolvedValue(metadata([{ name: paymentStateTokenName(confirmed), namedRangeId: "token_1" }]));

    await expect(reconcileManualConfirmations()).resolves.toBe(1);

    const update = batchUpdate.mock.calls.at(-1)?.[0].requestBody.requests.find((request: SheetRequest) => request.updateCells)?.updateCells;
    expect(update?.rows[0]?.values[37]?.userEnteredValue.stringValue).toBe("FALSE");
  });

  it("sweeps pending ADMIN and CLIENT_UPLOAD terminal-effect markers during the cron manual-reconciliation phase", async () => {
    const admin = payment({ payment_id: "admin", status: "MANUAL_CONFIRMED", manual_confirmed_at: "done", line_slip_error: "TRANSITION_EFFECTS_PENDING:ADMIN:REVIEW" });
    const upload = payment({ rowNumber: 3, payment_id: "upload", status: "AUTO_RECORDED", line_slip_error: "TRANSITION_EFFECTS_PENDING:CLIENT_UPLOAD:PENDING" });
    get.mockImplementation(async ({ range }: { range: string }) => ({ data: { values: range === "Payments!A:AW" ? [PAYMENT_HEADERS, row(admin), row(upload)] : [] } }));
    listSchedules.mockResolvedValue([
      { schedule_id: "schedule_admin", payment_id: "admin", status: "GENERATED" },
      { schedule_id: "schedule_upload", payment_id: "upload", status: "GENERATED" },
    ]);

    await expect(reconcileManualConfirmations()).resolves.toBe(0);

    expect(reconcileTerminalPaymentEffects).toHaveBeenCalledWith(expect.objectContaining({ payment: expect.objectContaining({ payment_id: "admin", line_slip_error: "TRANSITION_EFFECTS_PENDING:ADMIN:REVIEW" }), schedule: expect.objectContaining({ payment_id: "admin" }) }));
    expect(reconcileTerminalPaymentEffects).toHaveBeenCalledWith(expect.objectContaining({ payment: expect.objectContaining({ payment_id: "upload", line_slip_error: "TRANSITION_EFFECTS_PENDING:CLIENT_UPLOAD:PENDING" }), schedule: expect.objectContaining({ payment_id: "upload" }) }));
  });
});
