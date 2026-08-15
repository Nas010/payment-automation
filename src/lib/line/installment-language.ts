const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"] as const;
const TEENS = ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"] as const;
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"] as const;
const SCALES = ["", "thousand", "million", "billion", "trillion", "quadrillion"] as const;

function assertInstallmentInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("Installment value must be a positive safe integer");
  }
}

function chunkWords(value: number): string[] {
  const words: string[] = [];
  const hundreds = Math.floor(value / 100);
  const remainder = value % 100;

  if (hundreds) {
    words.push(ONES[hundreds], "hundred");
  }

  if (remainder >= 20) {
    words.push(TENS[Math.floor(remainder / 10)]);
    if (remainder % 10) {
      words.push(ONES[remainder % 10]);
    }
  } else if (remainder >= 10) {
    words.push(TEENS[remainder - 10]);
  } else if (remainder) {
    words.push(ONES[remainder]);
  }

  return words;
}

export function formatCardinalWord(value: number): string {
  assertInstallmentInteger(value);

  const groups: string[] = [];
  let remaining = value;
  let scale = 0;

  while (remaining > 0) {
    const chunk = remaining % 1000;
    if (chunk) {
      groups.unshift([...chunkWords(chunk), SCALES[scale]].filter(Boolean).join(" "));
    }
    remaining = Math.floor(remaining / 1000);
    scale += 1;
  }

  return groups.join(" ");
}

export function formatOrdinalNumber(value: number): string {
  assertInstallmentInteger(value);

  const lastTwo = value % 100;
  const suffix = lastTwo >= 11 && lastTwo <= 13
    ? "th"
    : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[value % 10] ?? "th";

  return `${value}${suffix}`;
}

const IRREGULAR_ORDINALS: Record<string, string> = {
  one: "first",
  two: "second",
  three: "third",
  five: "fifth",
  eight: "eighth",
  nine: "ninth",
  twelve: "twelfth",
};

export function formatOrdinalWord(value: number): string {
  const words = formatCardinalWord(value).split(" ");
  const last = words.at(-1)!;
  words[words.length - 1] = IRREGULAR_ORDINALS[last]
    ?? (last.endsWith("y") ? `${last.slice(0, -1)}ieth` : `${last}th`);

  return words.join(" ");
}
