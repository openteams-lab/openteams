/**
 * Utility functions for the Build Statistics page.
 * Handles date formatting, title truncation, number/price formatting,
 * and price validation.
 */

/**
 * Formats a YYYY-MM-DD date string to MM/DD format.
 * Both month and day are zero-padded to two digits.
 */
export function formatChartDate(date: string): string {
  const parts = date.split('-');
  const month = parts[1];
  const day = parts[2];
  if (!month || !day) return date || '';
  return `${month}/${day}`;
}

/**
 * Truncates a title string to a maximum length (default 60).
 * If the string exceeds maxLen, returns the first maxLen characters
 * followed by an ellipsis character (U+2026).
 */
export function truncateTitle(title: string, maxLen: number = 60): string {
  if (title.length <= maxLen) {
    return title;
  }
  return title.slice(0, maxLen) + '\u2026';
}

/**
 * Formats a non-negative integer with thousands separators (commas).
 * E.g., 1234567 → "1,234,567"
 */
export function formatNumber(n: number): string {
  return n.toLocaleString('en-US', {
    useGrouping: true,
    maximumFractionDigits: 0,
  });
}

export function formatCompactNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';

  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    const value = n / 1_000_000;
    const digits = Math.abs(value) >= 10 ? 1 : 2;
    return `${Number(value.toFixed(digits))}M`;
  }

  return formatNumber(n);
}

/**
 * Formats a non-negative number as a price string with a dollar sign
 * and exactly 4 decimal places. E.g., 2.5 → "$2.5000"
 */
export function formatPrice(n: number): string {
  return `$${n.toFixed(4)}`;
}

/**
 * Validates a price string input.
 * Returns valid: true if the string represents a non-negative number
 * with at most 6 decimal places and value ≤ 10000.
 * Returns valid: false with an error code otherwise.
 */
export function validatePrice(value: string): {
  valid: boolean;
  parsed: number;
  error?: string;
} {
  const num = parseFloat(value);
  if (isNaN(num))
    return { valid: false, parsed: 0, error: 'invalid_number' };
  if (num < 0) return { valid: false, parsed: 0, error: 'negative' };
  if (num > 10000)
    return { valid: false, parsed: 0, error: 'exceeds_max' };
  const decimalPart = value.split('.')[1];
  if (decimalPart && decimalPart.length > 6)
    return { valid: false, parsed: 0, error: 'too_many_decimals' };
  return { valid: true, parsed: num };
}
