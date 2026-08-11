const CP = {
  spreadsheetId: '1I7N201rghJ77R2vEk6ZvqOD1kZB-dCZrDD5sD3aArjA',
  dashboard: 'Dashboard', clients: 'Clients', payments: 'Payments', settings: 'Settings', schedule: 'Installment Schedule', audit: 'Audit Log',
  clientHeaders: ['client_id', 'active', 'client_name', 'line_user_id', 'line_display_name', 'package_name', 'payment_type', 'total_price_thb', 'installment_count', 'interval_months', 'first_due_date', 'default_amount_thb', 'billing_frequency', 'next_due_date', 'notes', 'created_at', 'updated_at', 'line_link_code', 'line_link_code_expires_at', 'line_link_status', 'line_linked_at', 'line_link_message', 'line_link_error'],
  dashboardForm: { clientName: 'B4', packageName: 'E5', paymentType: 'B6', firstDueDate: 'E6', totalPrice: 'B7', installmentCount: 'E7', intervalMonths: 'B8', notes: 'E8' },
  packageStartRow: 4,
};

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Coaching Payments')
    .addItem('Save client from Dashboard', 'saveClientFromDashboard')
    .addItem('Clear Dashboard form', 'clearDashboardForm')
    .addSeparator()
    .addItem('Generate missing LINE link codes', 'generateMissingLineLinkCodes')
    .addItem('Renew LINE code for selected client', 'renewLineCodeForSelectedClient')
    .addItem("Disconnect selected client's LINE", 'disconnectSelectedClientLine')
    .addSeparator()
    .addItem('Generate links due today', 'generateDuePaymentLinks')
    .addItem('Remove legacy daily payment scheduler', 'removeLegacyDailyPaymentScheduler')
    .addToUi();
}

function onEdit(event) {
  if (!event || event.range.getSheet().getName() !== CP.dashboard || event.range.getA1Notation() !== CP.dashboardForm.packageName) return;
  ensureClientSchema_();
  const packageConfig = packageByName_(String(event.range.getValue() || '').trim());
  if (!packageConfig) return;
  const dashboard = event.range.getSheet();
  dashboard.getRange(CP.dashboardForm.paymentType).setValue(packageConfig.paymentType);
  dashboard.getRange(CP.dashboardForm.totalPrice).setValue(packageConfig.totalPrice);
  dashboard.getRange(CP.dashboardForm.installmentCount).setValue(packageConfig.installmentCount);
  dashboard.getRange(CP.dashboardForm.intervalMonths).setValue(packageConfig.intervalMonths);
}

function saveClientFromDashboard() {
  ensureClientSchema_();
  const book = book_();
  const dashboard = book.getSheetByName(CP.dashboard);
  const value = (key) => dashboard.getRange(CP.dashboardForm[key]).getValue();
  const clientName = String(value('clientName') || '').trim();
  const packageName = String(value('packageName') || '').trim();
  const paymentType = String(value('paymentType') || '').trim();
  const firstDueDate = value('firstDueDate');
  const totalPrice = Number(value('totalPrice'));
  const installmentCount = Number(value('installmentCount'));
  const intervalMonths = Number(value('intervalMonths'));
  const notes = String(value('notes') || '').trim();
  const packageConfig = packageByName_(packageName);
  if (!clientName || !packageConfig || !packageConfig.active || !['ONE_TIME', 'INSTALLMENTS'].includes(paymentType) || !(firstDueDate instanceof Date) || !Number.isFinite(totalPrice) || totalPrice <= 0) {
    setDashboardStatus_('Fix required fields: client name, active package, type, due date, and positive total price.', true); return;
  }
  const count = paymentType === 'ONE_TIME' ? 1 : installmentCount;
  const interval = paymentType === 'ONE_TIME' ? 0 : intervalMonths;
  if (!Number.isInteger(count) || count < 1 || (paymentType === 'INSTALLMENTS' && (!Number.isInteger(interval) || interval < 1))) {
    setDashboardStatus_('Installment plans need whole installment count and interval of at least one month.', true); return;
  }
  const clientId = `client_${Utilities.getUuid().replaceAll('-', '')}`;
  const now = new Date();
  const lineCode = lineCodeForRows_(clientDataRows_());
  const lineFields = lineLinkFields_(clientName, lineCode, now);
  writeClient_([clientId, true, clientName, '', '', packageName, paymentType, totalPrice, count, interval, firstDueDate, totalPrice, 'MANUAL', firstDueDate, notes, now, now].concat(lineFields));
  const rows = buildScheduleRows_({ clientId, clientName, lineUserId: '', lineDisplayName: '', packageName, paymentType, totalPrice, count, interval, firstDueDate, notes, now });
  book.getSheetByName(CP.schedule).getRange(book.getSheetByName(CP.schedule).getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  appendAudit_('', clientId, 'CLIENT_CREATED', '', 'SCHEDULED', `${paymentType} plan created from Dashboard`, 'DASHBOARD_SCRIPT', JSON.stringify({ packageName, count, interval }));
  clearDashboardForm();
  setDashboardStatus_(`Saved ${clientName}. ${count} payment ${count === 1 ? 'link will' : 'links will'} be created on ${count === 1 ? 'its due date.' : 'their due dates.'}`);
}

function buildScheduleRows_(plan) {
  const totalSatang = Math.round(plan.totalPrice * 100);
  const base = Math.floor(totalSatang / plan.count);
  const remainder = totalSatang - base * plan.count;
  return Array.from({ length: plan.count }, (_, index) => {
    const dueDate = new Date(plan.firstDueDate);
    dueDate.setMonth(dueDate.getMonth() + index * plan.interval);
    const amountSatang = base + (index === plan.count - 1 ? remainder : 0);
    return [`schedule_${Utilities.getUuid().replaceAll('-', '')}`, plan.clientId, plan.clientName, plan.lineUserId, plan.lineDisplayName, plan.packageName, plan.paymentType, index + 1, plan.count, amountSatang / 100, dueDate, 'SCHEDULED', '', '', '', plan.notes, plan.now, plan.now];
  });
}

function writeClient_(values) {
  const sheet = book_().getSheetByName(CP.clients);
  const firstDataRow = 2;
  const lastRow = Math.max(sheet.getLastRow(), firstDataRow);
  const clientIds = sheet.getRange(firstDataRow, 1, lastRow - firstDataRow + 1, 1).getValues();
  const emptyIndex = clientIds.findIndex((row) => !String(row[0] || '').trim());
  const targetRow = emptyIndex === -1 ? lastRow + 1 : firstDataRow + emptyIndex;
  sheet.getRange(targetRow, 1, 1, values.length).setValues([values]);
}

function createLineLinkCode_() { return Utilities.getUuid().replaceAll('-', '').slice(0, 10).toUpperCase(); }
function lineLinkFields_(clientName, code, now) { const expiresAt = new Date(now); expiresAt.setUTCDate(expiresAt.getUTCDate() + 7); return [code, expiresAt, 'CODE_ACTIVE', '', `Hi ${clientName}, reply with this exact message to link your LINE account:\nLINK ${code}`, '']; }
function activeClient_(row) { return row[1] === true || String(row[1]).toUpperCase() === 'TRUE'; }
function normalizedLineCode_(value) { const code = String(value || '').toUpperCase(); return /^[A-F0-9]{10}$/.test(code) ? code : ''; }
function hasUnexpiredLineCode_(row, now) { const expiry = new Date(row[18]); return Boolean(normalizedLineCode_(row[17])) && !Number.isNaN(expiry.getTime()) && expiry.getTime() > now.getTime(); }
function clientDataRows_() { const sheet = book_().getSheetByName(CP.clients); const count = Math.max(0, sheet.getLastRow() - 1); if (!count) return []; const range = sheet.getRange(2, 1, count, CP.clientHeaders.length); const values = range.getValues(); const stateValues = range.getDisplayValues(); return values.map((item, index) => ({ row: index + 2, values: item, stateValues: stateValues[index] || item })).filter((item) => String(item.values[0] || '').trim()); }
function lineCodeForRows_(rows, usedCodes) { const used = usedCodes || new Set(rows.map((item) => normalizedLineCode_(item.values[17])).filter(Boolean)); for (let attempt = 0; attempt < 100; attempt += 1) { const code = createLineLinkCode_(); if (!used.has(code)) { used.add(code); return code; } } throw new Error('Unable to generate a unique LINE link code'); }
function writeLineFields_(row, fields, updatedAt) { book_().getSheetByName(CP.clients).getRange(row, 17, 1, 7).setValues([[updatedAt].concat(fields)]); }
function lineHash_(value) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8).map((byte) => ((byte + 256) % 256).toString(16).padStart(2, '0')).join(''); }
function lineReservationName_(kind, value) { return `line_link_${kind}_${lineHash_(value)}`; }
function lineStateReservationName_(values) { return `line_link_state_${lineHash_(JSON.stringify([0, 1, 3, 4, 17, 18, 19, 20, 21, 22, 16].map((index) => index === 1 ? (activeClient_(values) ? 'TRUE' : 'FALSE') : String(values[index] ?? ''))))}`; }
function lineCellValue_(value) { if (value instanceof Date) return { userEnteredValue: { numberValue: value.getTime() / 86400000 + 25569 } }; if (typeof value === 'number') return { userEnteredValue: { numberValue: value } }; if (typeof value === 'boolean') return { userEnteredValue: { boolValue: value } }; return { userEnteredValue: { stringValue: String(value ?? '') } }; }
function lineCellsRequest_(row, startColumnIndex, values) { return { updateCells: { range: { sheetId: book_().getSheetByName(CP.clients).getSheetId(), startRowIndex: row - 1, endRowIndex: row, startColumnIndex, endColumnIndex: startColumnIndex + values.length }, rows: [{ values: values.map(lineCellValue_) }], fields: 'userEnteredValue' } }; }
function lineNamedRangeId_(name) { const response = UrlFetchApp.fetch(`https://sheets.googleapis.com/v4/spreadsheets/${CP.spreadsheetId}?fields=namedRanges(namedRangeId,name)`, { method: 'get', headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` }, muteHttpExceptions: true }); if (response.getResponseCode() >= 300) throw new Error('Unable to read LINE reservations'); const namedRange = (JSON.parse(response.getContentText()).namedRanges || []).find((item) => item.name === name); return namedRange ? namedRange.namedRangeId : ''; }
function lineBatchUpdate_(requests) { const response = UrlFetchApp.fetch(`https://sheets.googleapis.com/v4/spreadsheets/${CP.spreadsheetId}:batchUpdate`, { method: 'post', contentType: 'application/json', headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` }, payload: JSON.stringify({ requests }), muteHttpExceptions: true }); if (response.getResponseCode() < 300) return true; if (response.getResponseCode() === 400 && /named range.*already exists/i.test(response.getContentText())) return false; throw new Error('Unable to update LINE link state'); }
function writeLineFieldsWithState_(item, fields, updatedAt, clearMapping, releaseLineUserId) { const sheet = book_().getSheetByName(CP.clients); const row = item.row; const reservationRange = { sheetId: sheet.getSheetId(), startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 0, endColumnIndex: 1 }; const requests = [{ addNamedRange: { namedRange: { name: lineStateReservationName_(item.stateValues || item.values), range: reservationRange } } }, ...(clearMapping ? [lineCellsRequest_(row, 3, ['', ''])] : []), lineCellsRequest_(row, 16, [updatedAt].concat(fields))]; if (releaseLineUserId) { const namedRangeId = lineNamedRangeId_(lineReservationName_('user', releaseLineUserId)); if (namedRangeId) requests.push({ deleteNamedRange: { namedRangeId } }); } return lineBatchUpdate_(requests); }
function selectedClientRow_() { const activeRange = SpreadsheetApp.getActiveRange(); if (!activeRange || activeRange.getSheet().getName() !== CP.clients || activeRange.getRow() < 2) { notifyLine_('Select a client data row in Clients (row 2 or later).', true); return null; } const range = book_().getSheetByName(CP.clients).getRange(activeRange.getRow(), 1, 1, CP.clientHeaders.length); const values = range.getValues()[0] || []; if (!String(values[0] || '').trim()) { notifyLine_('Selected row has no client record.', true); return null; } return { row: activeRange.getRow(), values, stateValues: range.getDisplayValues()[0] || values }; }
function notifyLine_(message, isError) { setDashboardStatus_(message, isError); SpreadsheetApp.getUi().alert(message); }

function generateMissingLineLinkCodes() {
  ensureClientSchema_();
  const rows = clientDataRows_(); const now = new Date(); const usedCodes = new Set(rows.map((item) => normalizedLineCode_(item.values[17])).filter(Boolean)); const result = { created: [], alreadyActive: [], alreadyLinked: [], skippedInactive: [], failed: [] };
  rows.forEach((item) => {
    const clientId = String(item.values[0]);
    if (!activeClient_(item.values)) { result.skippedInactive.push(clientId); return; }
    if (String(item.values[3] || '').trim()) { result.alreadyLinked.push(clientId); return; }
    if (hasUnexpiredLineCode_(item.values, now)) { result.alreadyActive.push(clientId); return; }
    try { const code = lineCodeForRows_(rows, usedCodes); if (!writeLineFieldsWithState_(item, lineLinkFields_(String(item.values[2] || '').trim(), code, now), now, false, '')) throw new Error('Client changed before LINE link code update'); appendAudit_('', clientId, 'LINE_LINK_CODE_CREATED', String(item.values[19] || ''), 'CODE_ACTIVE', 'LINE link code created', 'LINE_TRAINER', JSON.stringify({ clientId, status: 'CODE_ACTIVE' })); result.created.push(clientId); } catch (error) { result.failed.push({ clientId, error: error instanceof Error ? error.message : 'LINE link code generation failed' }); }
  });
  notifyLine_(`LINE codes: created ${result.created.length}; already active ${result.alreadyActive.length}; already linked ${result.alreadyLinked.length}; failed ${result.failed.length}.`, result.failed.length > 0);
  return result;
}

function renewLineCodeForSelectedClient() {
  ensureClientSchema_();
  const selected = selectedClientRow_(); if (!selected) return null;
  const clientId = String(selected.values[0]);
  if (!activeClient_(selected.values)) { notifyLine_('Cannot renew LINE code for an inactive client.', true); return null; }
  if (String(selected.values[3] || '').trim()) { notifyLine_('Cannot renew while selected client has a linked LINE user. Disconnect first.', true); return null; }
  const now = new Date(); const code = lineCodeForRows_(clientDataRows_()); if (!writeLineFieldsWithState_(selected, lineLinkFields_(String(selected.values[2] || '').trim(), code, now), now, false, '')) { notifyLine_('Client changed before LINE code renewal. Try again.', true); return null; } appendAudit_('', clientId, 'LINE_LINK_CODE_RENEWED', String(selected.values[19] || ''), 'CODE_ACTIVE', 'LINE link code renewed', 'LINE_TRAINER', JSON.stringify({ clientId, status: 'CODE_ACTIVE' })); notifyLine_(`Renewed LINE code for ${String(selected.values[2] || '').trim()}.`, false); return { clientId, code, status: 'CODE_ACTIVE' };
}

function disconnectSelectedClientLine() {
  ensureClientSchema_();
  const selected = selectedClientRow_(); if (!selected) return false;
  const clientId = String(selected.values[0]); const lineUserId = String(selected.values[3] || ''); const now = new Date();
  if (!writeLineFieldsWithState_(selected, ['', '', '', '', '', ''], now, true, lineUserId)) { notifyLine_('Client changed before LINE disconnect. Try again.', true); return false; } appendAudit_('', clientId, 'LINE_LINK_DISCONNECTED', String(selected.values[19] || ''), '', 'LINE account disconnected', 'LINE_TRAINER', JSON.stringify({ clientId, status: '', ...(lineUserId ? { lineUserSuffix: lineUserId.slice(-4) } : {}) })); notifyLine_(`Disconnected LINE for ${String(selected.values[2] || '').trim()}.`, false); return true;
}

function clearDashboardForm() {
  ensureClientSchema_();
  const sheet = book_().getSheetByName(CP.dashboard);
  Object.values(CP.dashboardForm).forEach((cell) => sheet.getRange(cell).clearContent());
}

function ensureClientSchema_() {
  const sheet = book_().getSheetByName(CP.clients);
  const maxColumns = sheet.getMaxColumns();
  if (maxColumns < CP.clientHeaders.length) sheet.insertColumnsAfter(maxColumns, CP.clientHeaders.length - maxColumns);
  const headers = sheet.getRange(1, 1, 1, CP.clientHeaders.length).getValues()[0] || [];
  CP.clientHeaders.forEach((header, index) => {
    if (!String(headers[index] ?? '').trim()) sheet.getRange(1, index + 1).setValue(header);
  });
}

function generateDuePaymentLinks() {
  const book = book_();
  const schedule = book.getSheetByName(CP.schedule);
  const values = schedule.getDataRange().getValues();
  const today = startOfDay_(new Date());
  const baseUrl = setting_('production_base_url').replace(/\/$/, '');
  let generated = 0;
  values.slice(1).forEach((row, index) => {
    const dueDate = row[10]; const status = row[11];
    if (status !== 'SCHEDULED' || !(dueDate instanceof Date) || startOfDay_(dueDate) > today) return;
    const paymentId = `pay_${Utilities.getUuid().replaceAll('-', '')}`;
    const token = Utilities.getUuid().replaceAll('-', '') + Utilities.getUuid().replaceAll('-', '');
    const paymentUrl = `${baseUrl}/p/${token}`;
    const now = new Date();
    const dueDateKey = Utilities.formatDate(dueDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    book.getSheetByName(CP.payments).appendRow([paymentId, row[1], row[2], Utilities.formatDate(dueDate, Session.getScriptTimeZone(), 'yyyy-MM'), row[9], dueDateKey, token, paymentUrl, 'PENDING', now, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', now, '']);
    schedule.getRange(index + 2, 12, 1, 4).setValues([['GENERATED', now, paymentId, paymentUrl]]);
    schedule.getRange(index + 2, 18).setValue(now);
    appendAudit_(paymentId, row[1], 'PAYMENT_LINK_GENERATED', '', 'PENDING', `Due-date link created for installment ${row[7]} of ${row[8]}`, 'DAILY_SCHEDULER', JSON.stringify({ scheduleId: row[0], paymentUrl }));
    generated += 1;
  });
  return generated;
}

function removeLegacyDailyPaymentScheduler() {
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === 'generateDuePaymentLinks')
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  setDashboardStatus_('Legacy daily payment scheduler removed. Vercel now owns automatic generation.');
}

function setting_(key) {
  const values = book_().getSheetByName(CP.settings).getRange('A2:B').getValues();
  const found = values.find((row) => row[0] === key);
  if (!found || !found[1] || found[1] === 'CONFIG_REQUIRED') throw new Error(`Settings value required: ${key}`);
  return String(found[1]);
}

function packageByName_(packageName) {
  const rows = book_().getSheetByName(CP.settings).getRange('D4:I').getValues();
  const row = rows.find((value) => String(value[0] || '').trim() === packageName);
  if (!row) return null;
  return { totalPrice: Number(row[1]), paymentType: String(row[2]), installmentCount: Number(row[3]), intervalMonths: Number(row[4]), active: row[5] === true || String(row[5]).toUpperCase() === 'TRUE' };
}

function appendAudit_(paymentId, clientId, action, previousStatus, newStatus, reason, source, metadata) {
  book_().getSheetByName(CP.audit).appendRow([new Date(), paymentId, clientId, action, previousStatus, newStatus, reason, source, metadata]);
}

function startOfDay_(value) { const date = new Date(value); date.setHours(0, 0, 0, 0); return date; }
function book_() { return SpreadsheetApp.openById(CP.spreadsheetId); }
function setDashboardStatus_(message, isError) { const cell = book_().getSheetByName(CP.dashboard).getRange('A10'); cell.setValue(message); cell.setFontColor(isError ? '#B91C1C' : '#FFFFFF'); }
