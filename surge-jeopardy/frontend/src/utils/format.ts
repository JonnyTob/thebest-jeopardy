/**
 * Formats a score/money value as a signed dollar string, e.g. 500 -> "$500", -500 -> "-$500".
 */
export function formatMoney(n: number): string {
  return n < 0 ? `-$${Math.abs(n)}` : `$${n}`;
}

/**
 * Formats a score change/delta as a signed dollar string, including an explicit "+" for
 * positive values and "$0" for zero, e.g. 500 -> "+$500", -500 -> "-$500", 0 -> "$0".
 */
export function formatMoneyChange(n: number): string {
  if (n > 0) return `+$${n}`;
  if (n < 0) return `-$${Math.abs(n)}`;
  return '$0';
}
