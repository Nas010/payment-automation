function normalized(value: string): string {
  return value.normalize("NFKD").replace(/[\p{P}\s]/gu, "").toUpperCase();
}

export function receiverFromOcrText(text: string, aliases: string[]): string | null {
  const haystack = normalized(text);
  return aliases.find((alias) => {
    const needle = normalized(alias);
    return needle.length >= 3 && haystack.includes(needle);
  }) ?? null;
}
