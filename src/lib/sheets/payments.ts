import { createHash } from "node:crypto";
import { getGoogleSheets } from "./client";
import { ensurePaymentSchema } from "./migration";
import { PAYMENT_HEADERS, recordToRow, rowToRecord, sheetColumnName } from "./records";
import { listSchedules } from "./schedules";
import { needsManualConfirmationAudit } from "@/lib/payments/manual-confirmation";

type PaymentFields = { [Key in (typeof PAYMENT_HEADERS)[number]]: string };
export type PaymentRecord = PaymentFields & { rowNumber: number };
export type NewPaymentRecord = Omit<PaymentRecord, "rowNumber">;
export type PaymentAuditInput = { paymentId: string; clientId: string; action: string; previousStatus: string; newStatus: string; reason: string; source: string; metadata?: string };

function paymentStatePrefix(paymentId: string): string {
  return `payment_state_${createHash("sha256").update(paymentId).digest("hex")}_`;
}

export function paymentStateTokenName(payment: PaymentRecord): string {
  const stateHash = createHash("sha256").update(JSON.stringify(recordToRow(PAYMENT_HEADERS, payment))).digest("hex");
  return `${paymentStatePrefix(payment.payment_id)}${stateHash}`;
}

function paymentStateConflict(error: unknown): boolean {
  const status = typeof error === "object" && error !== null && "response" in error
    ? (error as { response?: { status?: unknown } }).response?.status
    : undefined;
  return status === 400 && error instanceof Error && /named range|deletenamedrange/i.test(error.message);
}

async function paymentSheetMetadata(): Promise<{ sheetId: number; namedRanges: Array<{ name?: string | null; namedRangeId?: string | null }> }> {
  const { sheets, spreadsheetId } = await getGoogleSheets();
  const response = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets(properties(sheetId,title)),namedRanges(namedRangeId,name)" });
  const sheetId = response.data.sheets?.find((sheet) => sheet.properties?.title === "Payments")?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) throw new Error("Payments sheet is required");
  return { sheetId, namedRanges: response.data.namedRanges ?? [] };
}

function paymentCell(value: string) {
  return { userEnteredValue: { stringValue: value } };
}

function paymentRowRequest(payment: PaymentRecord, sheetId: number) {
  const rowStart = payment.rowNumber - 1;
  return { updateCells: { range: { sheetId, startRowIndex: rowStart, endRowIndex: rowStart + 1, startColumnIndex: 0, endColumnIndex: PAYMENT_HEADERS.length }, rows: [{ values: recordToRow(PAYMENT_HEADERS, payment).map(paymentCell) }], fields: "userEnteredValue" } };
}

function paymentTokenRequest(payment: PaymentRecord, sheetId: number) {
  const rowStart = payment.rowNumber - 1;
  return { addNamedRange: { namedRange: { name: paymentStateTokenName(payment), range: { sheetId, startRowIndex: rowStart, endRowIndex: rowStart + 1, startColumnIndex: 0, endColumnIndex: PAYMENT_HEADERS.length } } } };
}

function samePaymentState(left: PaymentRecord, right: PaymentRecord): boolean {
  return left.rowNumber === right.rowNumber && recordToRow(PAYMENT_HEADERS, left).every((value, index) => value === recordToRow(PAYMENT_HEADERS, right)[index]);
}

async function readPaymentRow(payment: PaymentRecord): Promise<PaymentRecord | null> {
  const { sheets, spreadsheetId } = await getGoogleSheets();
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `Payments!A${payment.rowNumber}:${sheetColumnName(PAYMENT_HEADERS.length)}${payment.rowNumber}` });
  const row = response.data.values?.[0];
  if (!row) return null;
  return { ...rowToRecord(PAYMENT_HEADERS, row), rowNumber: payment.rowNumber } as PaymentRecord;
}

function tokenRanges(metadata: Awaited<ReturnType<typeof paymentSheetMetadata>>, paymentId: string) {
  const prefix = paymentStatePrefix(paymentId);
  return metadata.namedRanges.filter((range) => typeof range.name === "string" && range.name.startsWith(prefix));
}

const PAYMENT_TOKEN_REPAIR_ATTEMPTS = 3;

async function stabilizePaymentStateToken(payment: PaymentRecord): Promise<void> {
  const { sheets, spreadsheetId } = await getGoogleSheets();
  let lastRepairError: unknown;
  for (let attempt = 0; attempt < PAYMENT_TOKEN_REPAIR_ATTEMPTS; attempt += 1) {
    const actualBeforeMetadata = await readPaymentRow(payment);
    if (!actualBeforeMetadata || actualBeforeMetadata.payment_id !== payment.payment_id) throw new Error("Payment changed during token repair");
    const metadata = await paymentSheetMetadata();
    const actualAfterMetadata = await readPaymentRow(payment);
    if (!actualAfterMetadata || actualAfterMetadata.payment_id !== payment.payment_id) throw new Error("Payment changed during token repair");
    if (!samePaymentState(actualBeforeMetadata, actualAfterMetadata)) continue;

    const tokens = tokenRanges(metadata, payment.payment_id);
    const currentTokenName = paymentStateTokenName(actualAfterMetadata);
    const currentTokens = tokens.filter((token) => token.name === currentTokenName);
    if (tokens.length === 1 && currentTokens.length === 1 && currentTokens[0].namedRangeId) {
      return;
    }
    if (tokens.some((token) => !token.namedRangeId) || currentTokens.length > 1) continue;

    const requests = [
      ...tokens.filter((token) => token.name !== currentTokenName).map((token) => ({ deleteNamedRange: { namedRangeId: token.namedRangeId as string } })),
      ...(currentTokens.length === 0 ? [paymentTokenRequest(actualAfterMetadata, metadata.sheetId)] : []),
    ];
    if (!requests.length) continue;
    try {
      await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
      return;
    } catch (error) {
      lastRepairError = error;
    }
  }
  if (lastRepairError) throw lastRepairError;
  throw new Error("Payment state token repair did not stabilize");
}

export async function listPayments(): Promise<PaymentRecord[]> {
  await ensurePaymentSchema();
  const { sheets, spreadsheetId } = await getGoogleSheets();
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `Payments!A:${sheetColumnName(PAYMENT_HEADERS.length)}` });
  return (response.data.values ?? []).slice(1).map((row, index) => ({ ...rowToRecord(PAYMENT_HEADERS, row), rowNumber: index + 2 }) as PaymentRecord).filter((row) => row.payment_id);
}

export async function getPaymentByToken(token: string): Promise<PaymentRecord | null> {
  return (await listPayments()).find((payment) => payment.public_token === token) ?? null;
}

export async function getPaymentById(paymentId: string): Promise<PaymentRecord | null> {
  return (await listPayments()).find((payment) => payment.payment_id === paymentId) ?? null;
}

export async function appendPayment(payment: NewPaymentRecord): Promise<void> {
  await ensurePaymentSchema();
  const { sheets, spreadsheetId } = await getGoogleSheets();
  await sheets.spreadsheets.values.append({ spreadsheetId, range: `Payments!A:${sheetColumnName(PAYMENT_HEADERS.length)}`, valueInputOption: "USER_ENTERED", requestBody: { values: [recordToRow(PAYMENT_HEADERS, payment)] } });
}

export async function updatePayment(payment: PaymentRecord): Promise<void> {
  if (!Number.isInteger(payment.rowNumber) || payment.rowNumber < 2) throw new Error("Payment physical row is required");
  await ensurePaymentSchema();
  const { sheets, spreadsheetId } = await getGoogleSheets();
  let metadata = await paymentSheetMetadata();
  let tokens = tokenRanges(metadata, payment.payment_id);
  if (!tokens.length) {
    const initialActual = await readPaymentRow(payment);
    if (!initialActual || initialActual.payment_id !== payment.payment_id) throw new Error("Payment changed before update");
    let bootstrapConflicted = false;
    let bootstrapError: unknown;
    try {
      await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [paymentTokenRequest(initialActual, metadata.sheetId)] } });
    } catch (error) {
      bootstrapError = error;
      bootstrapConflicted = paymentStateConflict(error);
    }
    const refreshedActual = await readPaymentRow(payment);
    metadata = await paymentSheetMetadata();
    tokens = tokenRanges(metadata, payment.payment_id);
    if (bootstrapError || !refreshedActual || !samePaymentState(refreshedActual, initialActual) || tokens.length !== 1 || tokens[0].name !== paymentStateTokenName(initialActual) || !tokens[0].namedRangeId) {
      await stabilizePaymentStateToken(payment);
      if (bootstrapError && !bootstrapConflicted) throw bootstrapError;
      throw new Error("Payment changed before update");
    }
  }
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
    ...tokens.filter((range) => range.namedRangeId).map((range) => ({ deleteNamedRange: { namedRangeId: range.namedRangeId as string } })),
    paymentTokenRequest(payment, metadata.sheetId),
    paymentRowRequest(payment, metadata.sheetId),
  ] } });
}

/** Atomically writes a payment row only while its complete expected state is unchanged. */
export async function updatePaymentIfUnchanged({ payment, expectedPayment }: { payment: PaymentRecord; expectedPayment: PaymentRecord }): Promise<boolean> {
  if (!Number.isInteger(payment.rowNumber) || payment.rowNumber < 2) throw new Error("Payment physical row is required");
  if (payment.rowNumber !== expectedPayment.rowNumber) throw new Error("Payment and expected payment must target the same physical row");
  await ensurePaymentSchema();
  const { sheets, spreadsheetId } = await getGoogleSheets();
  const initialActual = await readPaymentRow(expectedPayment);
  if (!initialActual || !samePaymentState(initialActual, expectedPayment)) return false;
  let metadata = await paymentSheetMetadata();
  let tokens = tokenRanges(metadata, expectedPayment.payment_id);
  const expectedTokenName = paymentStateTokenName(expectedPayment);
  let currentToken = tokens.find((token) => token.name === expectedTokenName && token.namedRangeId) ?? null;
  if (!currentToken) {
    if (tokens.length) {
      await stabilizePaymentStateToken(expectedPayment);
      return false;
    }
    try {
      await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [paymentTokenRequest(expectedPayment, metadata.sheetId)] } });
    } catch (error) {
      const conflict = paymentStateConflict(error);
      await stabilizePaymentStateToken(expectedPayment);
      if (conflict) return false;
      throw error;
    }
    metadata = await paymentSheetMetadata();
    tokens = tokenRanges(metadata, expectedPayment.payment_id);
    currentToken = tokens.find((token) => token.name === expectedTokenName && token.namedRangeId) ?? null;
    const refreshedActual = await readPaymentRow(expectedPayment);
    if (!currentToken || tokens.length !== 1 || !refreshedActual || !samePaymentState(refreshedActual, expectedPayment)) {
      await stabilizePaymentStateToken(expectedPayment);
      return false;
    }
  }
  if (tokens.length !== 1 || !currentToken.namedRangeId) {
    await stabilizePaymentStateToken(expectedPayment);
    return false;
  }
  try {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
      { deleteNamedRange: { namedRangeId: currentToken.namedRangeId } },
      paymentTokenRequest(payment, metadata.sheetId),
      paymentRowRequest(payment, metadata.sheetId),
    ] } });
    return true;
  } catch (error) {
    if (paymentStateConflict(error)) return false;
    throw error;
  }
}

export async function appendAudit(record: PaymentAuditInput): Promise<void> {
  const { sheets, spreadsheetId } = await getGoogleSheets();
  await sheets.spreadsheets.values.append({ spreadsheetId, range: "Audit Log!A:I", valueInputOption: "USER_ENTERED", requestBody: { values: [[new Date().toISOString(), record.paymentId, record.clientId, record.action, record.previousStatus, record.newStatus, record.reason, record.source, record.metadata ?? ""]] } });
}

export async function reconcileManualConfirmations(): Promise<number> {
  const payments = await listPayments();
  let reconciled = 0;
  for (const payment of payments) {
    if (!needsManualConfirmationAudit(payment)) continue;
    const timestamp = new Date().toISOString();
    await updatePayment({ ...payment, manual_confirmed_at: timestamp, line_slip_expected: "FALSE", updated_at: timestamp });
    await appendAudit({ paymentId: payment.payment_id, clientId: payment.client_id, action: "MANUAL_CONFIRMED", previousStatus: "REVIEW_OR_FLAGGED", newStatus: "MANUAL_CONFIRMED", reason: "Spreadsheet manual override reconciled", source: "CRON_RECONCILIATION" });
    reconciled += 1;
  }
  const terminalMarkers = payments.filter((payment) => ["AUTO_RECORDED", "MANUAL_CONFIRMED"].includes(payment.status)
    && /^(TRANSITION_EFFECTS_PENDING|TRANSITION_EFFECTS_CLAIMED):/.test(payment.line_slip_error));
  if (terminalMarkers.length) {
    const [schedules, { reconcileTerminalPaymentEffects }] = await Promise.all([listSchedules(), import("@/lib/payments/transition")]);
    for (const payment of terminalMarkers) {
      const schedule = schedules.find((item) => item.payment_id === payment.payment_id);
      if (!schedule) continue;
      try {
        await reconcileTerminalPaymentEffects({ payment, schedule });
      } catch {
        // Leave durable marker for the next cron/manual reconciliation run.
      }
    }
  }
  return reconciled;
}
