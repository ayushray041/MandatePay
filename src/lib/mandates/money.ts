export function currencyFractionDigits(currency: string): number {
  const digits = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).resolvedOptions().maximumFractionDigits;
  if (digits === undefined) {
    throw new Error(`Currency ${currency} does not have a supported minor-unit precision.`);
  }
  return digits;
}

export function parseMajorAmount(value: string, currency: string): number | null {
  const digits = currencyFractionDigits(currency);
  const amountPattern = digits === 0
    ? /^\d+$/
    : new RegExp(`^\\d+(?:\\.\\d{1,${digits}})?$`);
  const normalized = value.trim();
  if (!amountPattern.test(normalized)) {
    return null;
  }

  const [whole, fraction = ''] = normalized.split('.');
  const minorAmount =
    Number(whole) * 10 ** digits
    + Number(fraction.padEnd(digits, '0') || 0);
  return Number.isSafeInteger(minorAmount) && minorAmount > 0
    ? minorAmount
    : null;
}

export function formatMinorAmount(amountMinor: number, currency: string): string {
  const digits = currencyFractionDigits(currency);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amountMinor / 10 ** digits);
}
