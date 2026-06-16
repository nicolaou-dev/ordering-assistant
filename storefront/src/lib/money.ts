// Format minor units (cents) as currency — the catalog and cart both speak
// minor units, so this is the single place money becomes a display string.
export function money(minor: number, currency: string): string {
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(minor / 100);
}
