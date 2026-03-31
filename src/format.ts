// Terminal output formatting — ANSI escape codes, no dependencies

const enabled = process.stdout.isTTY !== false;

function wrap(code: string, text: string): string {
  if (!enabled) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

export const red = (s: string) => wrap("0;31", s);
export const yellow = (s: string) => wrap("0;33", s);
export const green = (s: string) => wrap("0;32", s);
export const cyan = (s: string) => wrap("0;36", s);
export const bold = (s: string) => wrap("1", s);
export const dim = (s: string) => wrap("2", s);
export const reset = enabled ? "\x1b[0m" : "";

/** Colour a string based on error rate thresholds */
export function errColor(rate: number, text: string): string {
  if (rate > 5) return red(text);
  if (rate > 1) return yellow(text);
  return green(text);
}

/** Colour a string based on p99 latency thresholds (ms) */
export function p99Color(ms: number, text: string): string {
  if (ms > 5000) return red(text);
  if (ms > 2000) return yellow(text);
  return green(text);
}

/** Colour a status code string */
export function statusColor(status: string): string {
  if (status.startsWith("5") || ["exception", "exceededCpu", "exceededMemory", "canceled"].includes(status)) {
    return red(status);
  }
  if (status.startsWith("4")) return yellow(status);
  if (status.startsWith("2") || status === "ok") return green(status);
  return dim(status);
}

/** Colour a project name based on health */
export function healthColor(errRate: number, p99: number, text: string): string {
  if (errRate > 5) return red(text);
  if (errRate > 1 || p99 > 5000) return yellow(text);
  return green(text);
}

/** Format a number with comma separators */
export function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

/** Right-pad a string to a given width */
export function pad(s: string, width: number): string {
  return s.padEnd(width);
}

/** Right-align a string to a given width */
export function rpad(s: string, width: number): string {
  return s.padStart(width);
}

/** Print a horizontal rule */
export function hr(width = 60): void {
  console.log(`  ${"-".repeat(width)}`);
}
