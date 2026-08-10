const CP = {
  dashboard: 'Dashboard', clients: 'Clients', payments: 'Payments', settings: 'Settings', schedule: 'Installment Schedule', audit: 'Audit Log',
  dashboardForm: { clientName: 'B4', lineUserId: 'E4', lineDisplayName: 'B5', packageName: 'E5', paymentType: 'B6', firstDueDate: 'E6', totalPrice: 'B7', installmentCount: 'E7', intervalMonths: 'B8', notes: 'E8' },
  packageStartRow: 4,
};

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Coaching Payments')
    .addItem('Save client from Dashboard', 'saveClientFromDashboard')
    .addItem('Clear Dashboard form', 'clearDashboardForm')
    .addSeparator()
    .addItem('Generate links due today', 'generateDuePaymentLinks')
    .addItem('Install 09:00 daily scheduler', 'installDailyScheduler')
    .addToUi();
}

function onEdit(event) {
  if (!event || event.range.getSheet().getName() !== CP.dashboard || event.range.getA1Notation() !== CP.dashboardForm.packageName) return;
  const packageConfig = packageByName_(String(event.range.getValue() || '').trim());
  if (!packageConfig) return;
  const dashboard = event.range.getSheet();
  dashboard.getRange(CP.dashboardForm.paymentType).setValue(packageConfig.paymentType);
  dashboard.getRange(CP.dashboardForm.totalPrice).setValue(packageConfig.totalPrice);
  dashboard.getRange(CP.dashboardForm.installmentCount).setValue(packageConfig.installmentCount);
  dashboard.getRange(CP.dashboardForm.intervalMonths).setValue(packageConfig.intervalMonths);
}

function saveClientFromDashboard() {
  const book = SpreadsheetApp.getActive();
  const dashboard = book.getSheetByName(CP.dashboard);
  const value = (key) => dashboard.getRange(CP.dashboardForm[key]).getValue();
  const clientName = String(value('clientName') || '').trim();
  const lineUserId = String(value('lineUserId') || '').trim();
  const lineDisplayName = String(value('lineDisplayName') || '').trim();
  const packageName = String(value('packageName') || '').trim();
  const paymentType = String(value('paymentType') || '').trim();
  const firstDueDate = value('firstDueDate');
  const totalPrice = Number(value('totalPrice'));
  const installmentCount = Number(value('installmentCount'));
  const intervalMonths = Number(value('intervalMonths'));
  const notes = String(value('notes') || '').trim();
  const ui = SpreadsheetApp.getUi();
  const packageConfig = packageByName_(packageName);
  if (!clientName || !packageConfig || !packageConfig.active || !['ONE_TIME', 'INSTALLMENTS'].includes(paymentType) || !(firstDueDate instanceof Date) || !Number.isFinite(totalPrice) || totalPrice <= 0) {
    ui.alert('Enter client name, package, payment type, first due date, and a positive total price.'); return;
  }
  const count = paymentType === 'ONE_TIME' ? 1 : installmentCount;
  const interval = paymentType === 'ONE_TIME' ? 0 : intervalMonths;
  if (!Number.isInteger(count) || count < 1 || !Number.isInteger(interval) || interval < 1) {
    ui.alert('Installment plans need a whole installment count and an interval of at least one month.'); return;
  }
  const clientId = `client_${Utilities.getUuid().replaceAll('-', '')}`;
  const now = new Date();
  book.getSheetByName(CP.clients).appendRow([clientId, true, clientName, lineUserId, lineDisplayName, packageName, paymentType, totalPrice, count, interval, firstDueDate, totalPrice, 'MANUAL', firstDueDate, notes, now, now]);
  const rows = buildScheduleRows_({ clientId, clientName, lineUserId, lineDisplayName, packageName, paymentType, totalPrice, count, interval, firstDueDate, notes, now });
  book.getSheetByName(CP.schedule).getRange(book.getSheetByName(CP.schedule).getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  appendAudit_('', clientId, 'CLIENT_CREATED', '', 'SCHEDULED', `${paymentType} plan created from Dashboard`, 'DASHBOARD_SCRIPT', JSON.stringify({ packageName, count, interval }));
  clearDashboardForm();
  ui.alert(`Saved ${clientName}. ${count} payment ${count === 1 ? 'link will' : 'links will'} be created on ${count === 1 ? 'its due date.' : 'their due dates.'}`);
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

function clearDashboardForm() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(CP.dashboard);
  Object.values(CP.dashboardForm).forEach((cell) => sheet.getRange(cell).clearContent());
}

function generateDuePaymentLinks() {
  const book = SpreadsheetApp.getActive();
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
    book.getSheetByName(CP.payments).appendRow([paymentId, row[1], row[2], Utilities.formatDate(dueDate, Session.getScriptTimeZone(), 'yyyy-MM'), row[9], dueDate, token, paymentUrl, 'PENDING', now, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', `Payment ${row[7]} of ${row[8]} for ${row[5]}`, now, '']);
    schedule.getRange(index + 2, 12, 1, 4).setValues([['GENERATED', now, paymentId, paymentUrl]]);
    schedule.getRange(index + 2, 18).setValue(now);
    appendAudit_(paymentId, row[1], 'PAYMENT_LINK_GENERATED', '', 'PENDING', `Due-date link created for installment ${row[7]} of ${row[8]}`, 'DAILY_SCHEDULER', JSON.stringify({ scheduleId: row[0], paymentUrl }));
    generated += 1;
  });
  return generated;
}

function installDailyScheduler() {
  ScriptApp.getProjectTriggers().filter((trigger) => trigger.getHandlerFunction() === 'generateDuePaymentLinks').forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('generateDuePaymentLinks').timeBased().atHour(9).everyDays(1).inTimezone('Asia/Bangkok').create();
  SpreadsheetApp.getUi().alert('Daily payment-link scheduler installed for 09:00 Asia/Bangkok.');
}

function setting_(key) {
  const values = SpreadsheetApp.getActive().getSheetByName(CP.settings).getRange('A2:B').getValues();
  const found = values.find((row) => row[0] === key);
  if (!found || !found[1] || found[1] === 'CONFIG_REQUIRED') throw new Error(`Settings value required: ${key}`);
  return String(found[1]);
}

function packageByName_(packageName) {
  const rows = SpreadsheetApp.getActive().getSheetByName(CP.settings).getRange('D4:I').getValues();
  const row = rows.find((value) => String(value[0] || '').trim() === packageName);
  if (!row) return null;
  return { totalPrice: Number(row[1]), paymentType: String(row[2]), installmentCount: Number(row[3]), intervalMonths: Number(row[4]), active: row[5] === true || String(row[5]).toUpperCase() === 'TRUE' };
}

function appendAudit_(paymentId, clientId, action, previousStatus, newStatus, reason, source, metadata) {
  SpreadsheetApp.getActive().getSheetByName(CP.audit).appendRow([new Date(), paymentId, clientId, action, previousStatus, newStatus, reason, source, metadata]);
}

function startOfDay_(value) { const date = new Date(value); date.setHours(0, 0, 0, 0); return date; }
