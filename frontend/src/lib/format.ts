export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const MON = MONTHS.map((m) => m.slice(0, 3));

export function compact(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e4) return `${Math.round(v / 1e3)}k`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  if (a >= 10) return Math.round(v).toString();
  if (a === 0) return "0";
  return v.toFixed(1).replace(/\.0$/, "");
}

export function full(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  return v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function ratio(v: number | null | undefined): string {
  if (v === null || v === undefined) return "–";
  return v >= 10 ? `${v.toFixed(0)}×` : `${v.toFixed(1)}×`;
}

export function ordinal(v: number | null | undefined): string {
  if (v === null || v === undefined) return "–";
  const n = Math.round(v);
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}

export function pct(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined) return "–";
  return `${(v * 100).toFixed(digits)}%`;
}

export function ymLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function monthRange(months: number[]): string {
  if (!months.length) return "–";
  return months.length === 1 ? MONTHS[months[0] - 1] : `${MON[months[0] - 1]}–${MON[months[months.length - 1] - 1]}`;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}
