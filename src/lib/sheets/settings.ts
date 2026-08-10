import { getGoogleSheets } from "./client";

export type OperationalSetting = { rowNumber: number; key: string; value: string };
export type PackageRecord = { rowNumber: number; package_name: string; total_price_thb: string; payment_type: string; installment_count: string; interval_months: string; active: string };

export async function listOperationalSettings(): Promise<OperationalSetting[]> {
  const { sheets, spreadsheetId } = getGoogleSheets();
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Settings!A:B" });
  return (response.data.values ?? []).slice(1).map((row, index) => ({ rowNumber: index + 2, key: String(row[0] ?? ""), value: String(row[1] ?? "") })).filter((item) => item.key);
}

export async function upsertOperationalSetting(key: string, value: string): Promise<void> {
  const settings = await listOperationalSettings();
  const rowNumber = settings.find((item) => item.key === key)?.rowNumber ?? Math.max(2, ...settings.map((item) => item.rowNumber + 1));
  const { sheets, spreadsheetId } = getGoogleSheets();
  await sheets.spreadsheets.values.update({ spreadsheetId, range: `Settings!A${rowNumber}:B${rowNumber}`, valueInputOption: "USER_ENTERED", requestBody: { values: [[key, value]] } });
}

export async function listPackages(): Promise<PackageRecord[]> {
  const { sheets, spreadsheetId } = getGoogleSheets();
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Settings!D:I" });
  return (response.data.values ?? []).slice(3).map((row, index) => ({ rowNumber: index + 4, package_name: String(row[0] ?? ""), total_price_thb: String(row[1] ?? ""), payment_type: String(row[2] ?? ""), installment_count: String(row[3] ?? ""), interval_months: String(row[4] ?? ""), active: String(row[5] ?? "") })).filter((item) => item.package_name);
}

export async function savePackage(item: Omit<PackageRecord, "rowNumber"> & { rowNumber?: number }): Promise<void> {
  const all = await listPackages();
  const duplicate = all.find((entry) => entry.package_name.toLocaleLowerCase() === item.package_name.toLocaleLowerCase() && entry.rowNumber !== item.rowNumber);
  if (duplicate) throw new Error("Package name must be unique");
  const rowNumber = item.rowNumber ?? Math.max(4, ...all.map((entry) => entry.rowNumber + 1));
  const { sheets, spreadsheetId } = getGoogleSheets();
  await sheets.spreadsheets.values.update({ spreadsheetId, range: `Settings!D${rowNumber}:I${rowNumber}`, valueInputOption: "USER_ENTERED", requestBody: { values: [[item.package_name, item.total_price_thb, item.payment_type, item.installment_count, item.interval_months, item.active]] } });
}
