import { recoverAmountFromOcrTexts, recoverReceiverFromOcrTexts } from "@/lib/slip/ocr";

const alias = "นางสาว พีรพร บุญสนิท";
const readableAmounts = ["5,900.00", "5900.00", "5 900.00"];
const readableReceivers = [
  "ไปยัง นางสาว พ่ธพร บุญสนิท XXX-XXX-8717",
  "ผู้รับ นางสาว พีรพ บุญสนก XXX-XXX-8717",
];

function requireCondition(condition: boolean, code: string): void {
  if (!condition) throw new Error(code);
}

let readablePassed = 0;
for (let seed = 0; seed < 50; seed += 1) {
  const first = readableAmounts[seed % readableAmounts.length]!;
  const second = readableAmounts[(seed + 1) % readableAmounts.length]!;
  const amount = recoverAmountFromOcrTexts([first, second]);
  requireCondition(amount.status === "RECOVERED" && amount.amountSatang === 590000, "READABLE_AMOUNT_FAILED");
  const receiver = recoverReceiverFromOcrTexts([
    readableReceivers[seed % readableReceivers.length]!,
    readableReceivers[(seed + 1) % readableReceivers.length]!,
  ], [alias]);
  requireCondition(receiver === alias, "READABLE_RECEIVER_FAILED");
  readablePassed += 1;
}

let degradedReviewed = 0;
for (let seed = 0; seed < 25; seed += 1) {
  const amount = recoverAmountFromOcrTexts(["5,800.00", "5,900.00"]);
  requireCondition(amount.status !== "RECOVERED", "DEGRADED_AMOUNT_ACCEPTED");
  const receiver = recoverReceiverFromOcrTexts([readableReceivers[seed % readableReceivers.length]!], [alias]);
  requireCondition(receiver === null, "DEGRADED_RECEIVER_ACCEPTED");
  degradedReviewed += 1;
}

console.log(JSON.stringify({ passed: true, readableVariants: readablePassed, degradedVariants: degradedReviewed }));
