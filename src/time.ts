// Time helpers — period parsing, ISO/epoch conversion
// Cross-platform: uses standard Date arithmetic, no macOS-specific date -v

export type Period = "1h" | "6h" | "24h" | "7d" | "30d";

const PERIOD_MS: Record<Period, number> = {
  "1h": 1 * 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

/** Check if a string is a valid period */
export function isValidPeriod(s: string): s is Period {
  return s in PERIOD_MS;
}

/** Convert a period string to a "from" ISO datetime */
export function periodToFrom(period: Period): string {
  const now = Date.now();
  const from = new Date(now - PERIOD_MS[period]);
  return toISO(from);
}

/** Get the current time as ISO string */
export function nowISO(): string {
  return toISO(new Date());
}

/** Format a Date as ISO 8601 UTC (no milliseconds) */
export function toISO(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Convert an ISO 8601 string to epoch milliseconds */
export function isoToEpochMs(iso: string): number {
  return new Date(iso).getTime();
}

/** Format epoch milliseconds as HH:MM:SS */
export function epochMsToTime(ms: number): string {
  const d = new Date(ms);
  return d.toISOString().slice(11, 19);
}

/** Format epoch milliseconds as YYYY-MM-DD HH:MM:SS */
export function epochMsToDatetime(ms: number): string {
  const d = new Date(ms);
  return d.toISOString().slice(0, 19).replace("T", " ");
}
