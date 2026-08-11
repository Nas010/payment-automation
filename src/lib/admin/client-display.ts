export function formatClientDirectoryCount(count: number): string {
  return `(${count})`;
}

export function formatPaymentProgress(paid: number, total: number): string {
  return `${paid} of ${total} paid`;
}
