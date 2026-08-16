const OCR_REVIEW_CODES = new Set([
  "OCR_LAYOUT_UNAVAILABLE",
  "OCR_PASS_FAILED",
  "OCR_AMOUNT_LABEL_MISSING",
  "OCR_AMOUNT_NO_CANDIDATE",
  "OCR_AMOUNT_AMBIGUOUS",
  "OCR_RECEIVER_NO_MATCH",
  "OCR_RECEIVER_AMBIGUOUS",
  "OCR_DATE_NO_MATCH",
]);

export function privacySafeOcrDiagnostics(reasons: readonly string[]): string[] {
  return [...new Set(reasons.filter((reason) => OCR_REVIEW_CODES.has(reason)))];
}
