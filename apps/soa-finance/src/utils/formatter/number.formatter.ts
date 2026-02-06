/**
 * Number Formatting Functions
 */

export function parseNumber(value: unknown): number {
  if (value === null || value === undefined) {
    return 0;
  }

  const num = Number.parseFloat(value.toString());
  return Number.isNaN(num) ? 0 : num;
}

export function formatCurrency(value: number, currency = "IDR"): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
  }).format(value);
}

export function formatThousands(value: number): string {
  return new Intl.NumberFormat("id-ID").format(value);
}
