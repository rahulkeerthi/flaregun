// Logs mode — Workers Observability Telemetry API for per-request detail

import { type AuthConfig, cfLogsApi } from "./api.js";
import { printAuthCheck, printObservabilityCheck } from "./prereqs.js";
import {
  bold,
  cyan,
  dim,
  red,
  yellow,
  green,
  statusColor,
  fmt,
  hr,
} from "./format.js";
import {
  type Period,
  periodToFrom,
  nowISO,
  isoToEpochMs,
  epochMsToTime,
  epochMsToDatetime,
} from "./time.js";

interface LogsOptions {
  config: AuthConfig;
  period: Period;
  filterName: string | null;
  since: string | null;
  limit: number;
  /** Called when logs mode falls back to scan */
  onFallbackToScan: () => Promise<void>;
}

// ── Telemetry API response types ──────────────────────────────────

interface TelemetryResponse {
  success?: boolean;
  result?: {
    events?: TelemetryEventsContainer | TelemetryEvent[];
    calculations?: TelemetryCalcContainer | TelemetryCalcRow[];
  };
  errors?: Array<{ message: string; code?: number }>;
}

interface TelemetryEventsContainer {
  events?: TelemetryEvent[];
  count?: number;
}

interface TelemetryEvent {
  timestamp?: number | string;
  Timestamp?: number | string;
  _timestamp?: number | string;
  "cloudflare.script_name"?: string;
  "faas.name"?: string;
  "$workers.scriptName"?: string;
  scriptName?: string;
  "http.response.status_code"?: string | number;
  "$workers.event.response.status"?: string | number;
  status_code?: string | number;
  outcome?: string;
  "cloudflare.outcome"?: string;
  "http.request.method"?: string;
  "$workers.event.request.method"?: string;
  "url.path"?: string;
  "$workers.event.request.url"?: string;
  "url.full"?: string;
  "$metadata.message"?: string;
  message?: string;
  log?: string;
  "cloudflare.wall_time_ms"?: number;
  "$workers.wallTimeMs"?: number;
  "cloudflare.cpu_time_ms"?: number;
  "$workers.cpuTimeMs"?: number;
  "exception.message"?: string;
  "error.message"?: string;
  [key: string]: unknown;
}

interface TelemetryCalcContainer {
  events?: TelemetryCalcRow[];
  calculations?: TelemetryCalcRow[];
}

interface TelemetryCalcRow {
  "url.path"?: string;
  "http.response.status_code"?: string | number;
  group?: {
    "url.path"?: string;
    "http.response.status_code"?: string | number;
  };
  total?: number;
  count?: number;
  result?: { total?: number };
  [key: string]: unknown;
}

interface KeysResponse {
  success?: boolean;
  result?: unknown[];
  errors?: Array<{ message: string }>;
}

// ── Helpers ───────────────────────────────────────────────────────

function buildFilters(filterName: string | null): object[] {
  if (!filterName) return [];
  return [
    {
      key: "cloudflare.script_name",
      operation: "eq",
      value: filterName,
      type: "string",
    },
  ];
}

function getEventTimestamp(evt: TelemetryEvent): string {
  const ts = evt.timestamp ?? evt.Timestamp ?? evt._timestamp ?? "";
  if (typeof ts === "number") {
    return epochMsToTime(ts);
  }
  return String(ts);
}

function getEventScript(evt: TelemetryEvent): string {
  return (
    evt["cloudflare.script_name"] ??
    evt["faas.name"] ??
    evt["$workers.scriptName"] ??
    evt.scriptName ??
    ""
  );
}

function getEventStatus(evt: TelemetryEvent): string {
  const s =
    evt["http.response.status_code"] ??
    evt["$workers.event.response.status"] ??
    evt.status_code ??
    evt.outcome ??
    evt["cloudflare.outcome"] ??
    "";
  return String(s);
}

function getEventMethod(evt: TelemetryEvent): string {
  return (
    evt["http.request.method"] ??
    evt["$workers.event.request.method"] ??
    ""
  );
}

function getEventPath(evt: TelemetryEvent): string {
  return (
    evt["url.path"] ??
    evt["$workers.event.request.url"] ??
    evt["url.full"] ??
    ""
  );
}

function getEventMessage(evt: TelemetryEvent): string {
  return (
    (evt["$metadata.message"] as string | undefined) ??
    (evt.message as string | undefined) ??
    (evt.log as string | undefined) ??
    ""
  );
}

function getEventWallMs(evt: TelemetryEvent): string {
  const v = evt["cloudflare.wall_time_ms"] ?? evt["$workers.wallTimeMs"] ?? "";
  return String(v);
}

function resolveEvents(container: TelemetryEventsContainer | TelemetryEvent[] | undefined): {
  events: TelemetryEvent[];
  count: number;
} {
  if (!container) return { events: [], count: 0 };
  if (Array.isArray(container)) return { events: container, count: container.length };
  const events = container.events ?? [];
  const count = container.count ?? events.length;
  return { events, count };
}

function resolveCalcs(
  result: TelemetryResponse["result"],
): TelemetryCalcRow[] {
  if (!result) return [];
  const container = result.calculations ?? result.events;
  if (!container) return [];
  if (Array.isArray(container)) return container as TelemetryCalcRow[];
  const inner = (container as TelemetryCalcContainer);
  return inner.events ?? inner.calculations ?? [];
}

// ── Log steps ─────────────────────────────────────────────────────

async function checkAccess(
  config: AuthConfig,
  fromMs: number,
  toMs: number,
  filters: object[],
): Promise<{ ok: boolean; keyCount: number; error?: string }> {
  console.log(bold("Checking observability access..."));

  try {
    const body = {
      datasets: ["events"],
      from: fromMs,
      to: toMs,
      filters,
      limit: 20,
    };

    const resp = (await cfLogsApi(
      config,
      "POST",
      `/accounts/${config.accountId}/workers/observability/telemetry/keys`,
      body,
    )) as KeysResponse;

    if (resp.success) {
      const keyCount = resp.result?.length ?? 0;
      return { ok: true, keyCount };
    }

    const msg = resp.errors?.[0]?.message ?? "unknown";
    return { ok: false, keyCount: 0, error: msg };
  } catch (e) {
    return { ok: false, keyCount: 0, error: (e as Error).message };
  }
}

async function fetchEvents(
  config: AuthConfig,
  fromMs: number,
  toMs: number,
  filters: object[],
  limit: number,
): Promise<void> {
  console.log(bold("Fetching recent events..."));
  console.log();

  const body = {
    queryId: `events-${Date.now()}`,
    timeframe: { from: fromMs, to: toMs },
    view: "events",
    limit,
    parameters: {
      datasets: ["events"],
      filters,
      filterCombination: "and",
      calculations: [{ operator: "count", alias: "count" }],
      orderBy: { value: "timestamp", order: "desc" },
    },
  };

  let resp: TelemetryResponse;
  try {
    resp = (await cfLogsApi(
      config,
      "POST",
      `/accounts/${config.accountId}/workers/observability/telemetry/query`,
      body,
    )) as TelemetryResponse;
  } catch (e) {
    console.log(red(`Failed to fetch events: ${(e as Error).message}`));
    return;
  }

  if (!resp.success) {
    const msg = resp.errors?.[0]?.message ?? String(resp).slice(0, 300);
    console.log(red(`Query error: ${msg}`));
    return;
  }

  const { events, count } = resolveEvents(resp.result?.events);

  if (events.length === 0) {
    console.log(yellow("No events found in this time window."));
    console.log(dim("Try a wider --period or check that the worker has [observability] enabled."));
    return;
  }

  console.log(bold(`Found ${events.length} events (total: ${count})`));
  console.log();

  const maxShow = 80;
  for (let i = 0; i < Math.min(events.length, maxShow); i++) {
    const evt = events[i];
    if (!evt || typeof evt !== "object") {
      console.log(`  ${dim(String(evt))}`);
      continue;
    }

    const ts = getEventTimestamp(evt);
    const script = getEventScript(evt);
    const status = getEventStatus(evt);
    const method = getEventMethod(evt);
    const path = getEventPath(evt);
    const wallMs = getEventWallMs(evt);
    const message = getEventMessage(evt);

    const parts: string[] = [dim(ts)];
    if (script) parts.push(bold(script));
    if (method || path) parts.push(`${method} ${path}`.trim());
    if (status) parts.push(statusColor(status));
    if (wallMs && wallMs !== "") parts.push(dim(`${wallMs}ms`));

    console.log(`  ${parts.join("  ")}`);

    if (message) {
      const truncated = String(message).slice(0, 200) + (String(message).length > 200 ? "..." : "");
      console.log(`    ${dim(truncated)}`);
    }
  }

  if (events.length > maxShow) {
    console.log(dim(`  ... (${events.length - maxShow} more)`));
  }
  console.log();
}

async function fetchErrors(
  config: AuthConfig,
  fromMs: number,
  toMs: number,
  filters: object[],
): Promise<void> {
  console.log(bold("Checking for exceptions and errors..."));
  console.log();

  const errorFilters: object[] = [
    ...filters,
    {
      key: "cloudflare.outcome",
      operation: "neq",
      value: "ok",
      type: "string",
    },
  ];

  const body = {
    queryId: `errors-${Date.now()}`,
    timeframe: { from: fromMs, to: toMs },
    view: "events",
    limit: 30,
    parameters: {
      datasets: ["events"],
      filters: errorFilters,
      filterCombination: "and",
      calculations: [{ operator: "count", alias: "count" }],
      orderBy: { value: "timestamp", order: "desc" },
    },
  };

  let resp: TelemetryResponse;
  try {
    resp = (await cfLogsApi(
      config,
      "POST",
      `/accounts/${config.accountId}/workers/observability/telemetry/query`,
      body,
    )) as TelemetryResponse;
  } catch (e) {
    console.log(yellow(`Could not fetch error events: ${(e as Error).message}`));
    return;
  }

  if (!resp.success) {
    console.log(yellow("Error query returned no results (this is OK if there are no errors)"));
    return;
  }

  const { events } = resolveEvents(resp.result?.events);

  if (events.length === 0) {
    console.log(green("No exceptions or non-ok outcomes found."));
    return;
  }

  console.log(`${red(bold(`Found ${events.length} error events:`))}`);
  console.log();

  for (let i = 0; i < Math.min(events.length, 30); i++) {
    const evt = events[i];

    const ts = (() => {
      const raw = evt.timestamp ?? evt.Timestamp ?? "";
      if (typeof raw === "number") return epochMsToDatetime(raw);
      return String(raw);
    })();

    const script = getEventScript(evt);
    const outcome = (evt["cloudflare.outcome"] ?? evt.outcome ?? "") as string;
    const status = getEventStatus(evt);
    const path = getEventPath(evt);
    const message = getEventMessage(evt);
    const exception = ((evt["exception.message"] ?? evt["error.message"] ?? "") as string);
    const wallMs = getEventWallMs(evt);

    console.log(`  ${red(ts)}  ${bold(script)}`);
    if (path) console.log(`    Path: ${path}`);
    if (status) console.log(`    Status: ${red(status)}`);
    if (outcome) console.log(`    Outcome: ${red(outcome)}`);
    if (exception) console.log(`    Exception: ${red(exception)}`);
    if (message) {
      console.log(`    Message: ${String(message).slice(0, 300)}`);
    }
    if (wallMs && wallMs !== "") console.log(`    Wall time: ${wallMs}ms`);
    console.log();
  }
}

async function fetchPathBreakdown(
  config: AuthConfig,
  fromMs: number,
  toMs: number,
  filters: object[],
): Promise<void> {
  console.log(bold("Top paths by error count..."));
  console.log();

  const body = {
    queryId: `paths-${Date.now()}`,
    timeframe: { from: fromMs, to: toMs },
    view: "calculations",
    limit: 20,
    parameters: {
      datasets: ["events"],
      filters,
      filterCombination: "and",
      calculations: [{ operator: "count", alias: "total" }],
      groupBys: [
        { type: "string", value: "url.path" },
        { type: "string", value: "http.response.status_code" },
      ],
      orderBy: { value: "total", order: "desc" },
    },
  };

  let resp: TelemetryResponse;
  try {
    resp = (await cfLogsApi(
      config,
      "POST",
      `/accounts/${config.accountId}/workers/observability/telemetry/query`,
      body,
    )) as TelemetryResponse;
  } catch (e) {
    console.log(yellow(`Could not fetch path breakdown: ${(e as Error).message}`));
    return;
  }

  if (!resp.success) {
    console.log(yellow("Path breakdown query returned no results"));
    return;
  }

  const calcs = resolveCalcs(resp.result);

  if (calcs.length === 0) {
    console.log(dim("No path data available (this is normal if the field is not indexed)."));
    return;
  }

  console.log(`  ${bold("Path".padEnd(40))} ${bold("Status".padEnd(8))} ${bold("Count".padStart(8))}`);
  hr(60);

  for (const row of calcs.slice(0, 20)) {
    if (typeof row !== "object") continue;

    const path = row["url.path"] ?? row.group?.["url.path"] ?? "?";
    const status = String(
      row["http.response.status_code"] ??
      row.group?.["http.response.status_code"] ??
      "?",
    );
    const count = row.total ?? row.count ?? (row.result as { total?: number })?.total ?? 0;

    const coloredStatus = statusColor(status);
    console.log(`  ${String(path).padEnd(40)} ${coloredStatus.padEnd(8)} ${fmt(count as number).padStart(8)}`);
  }

  console.log();
}

// ── Main logs entry point ─────────────────────────────────────────

export async function doLogs(opts: LogsOptions): Promise<void> {
  // Pre-req checks
  console.log(bold("Checking prerequisites..."));
  console.log();

  const authOk = await printAuthCheck(opts.config);
  if (!authOk) {
    process.exit(1);
  }

  printObservabilityCheck(opts.filterName);
  console.log();

  // Compute time window
  const fromIso = opts.since ?? periodToFrom(opts.period);
  const now = nowISO();
  const fromMs = isoToEpochMs(fromIso);
  const toMs = isoToEpochMs(now);
  const filters = buildFilters(opts.filterName);

  console.log(`${bold(cyan("Flaregun -- Logs"))}`);
  console.log(dim(`Window: ${fromIso} -> ${now}`));
  if (opts.filterName) {
    console.log(dim(`Filter: scriptName = ${opts.filterName}`));
  }
  console.log(dim(`Limit: ${opts.limit} events`));
  console.log();

  // Check observability access
  const access = await checkAccess(opts.config, fromMs, toMs, filters);

  if (!access.ok) {
    console.log(red(`Workers Observability API error: ${access.error}`));
    console.log();
    console.log(yellow("This usually means one of:"));
    console.log("  1. Observability is not enabled for this worker/project");
    console.log("     Add to wrangler.toml:  [observability]");
    console.log("                            enabled = true");
    console.log("  2. The API token lacks the required permissions");
    console.log("  3. No data exists for this time window");
    console.log();
    console.log(dim("Falling back to GraphQL analytics only..."));
    console.log();
    await opts.onFallbackToScan();
    return;
  }

  console.log(`${green("Connected")} -- ${access.keyCount} keys available`);
  console.log();

  // Fetch events, errors, path breakdown
  await fetchEvents(opts.config, fromMs, toMs, filters, opts.limit);
  await fetchErrors(opts.config, fromMs, toMs, filters);
  await fetchPathBreakdown(opts.config, fromMs, toMs, filters);
}
