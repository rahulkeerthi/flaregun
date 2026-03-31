// Scan mode — GraphQL Analytics API for error spikes, latency, status distributions

import { type AuthConfig, gql } from "./api.js";
import {
  bold,
  cyan,
  dim,
  red,
  yellow,
  green,
  errColor,
  p99Color,
  fmt,
} from "./format.js";
import { type Period, periodToFrom, nowISO } from "./time.js";

interface ScanOptions {
  config: AuthConfig;
  period: Period;
  filterName: string | null;
  errorsOnly: boolean;
}

// ── GraphQL response types ────────────────────────────────────────

interface InvocationRow {
  sum: { errors: number; requests: number; subrequests: number; wallTime: number };
  quantiles: {
    wallTimeP50: number;
    wallTimeP99: number;
    cpuTimeP50: number;
    cpuTimeP99: number;
  };
  dimensions: { scriptName: string; status?: string; datetime?: string };
}

interface GqlResponse {
  data?: {
    viewer?: {
      accounts?: Array<{
        workersInvocationsAdaptive?: InvocationRow[];
      }>;
    };
  };
  errors?: Array<{ message: string }>;
}

function getRows(data: GqlResponse): InvocationRow[] {
  try {
    return data.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? [];
  } catch {
    return [];
  }
}

function buildFilter(from: string, now: string, filterName: string | null): string {
  let f = `datetime_gt: "${from}", datetime_lt: "${now}"`;
  if (filterName) f += `, scriptName: "${filterName}"`;
  return f;
}

// ── Aggregation helpers ───────────────────────────────────────────

interface ScriptAgg {
  requests: number;
  errors: number;
  wallP50: number[];
  wallP99: number[];
  cpuP50: number[];
}

function aggregate(rows: InvocationRow[]): Map<string, ScriptAgg> {
  const scripts = new Map<string, ScriptAgg>();
  for (const r of rows) {
    const name = r.dimensions.scriptName || "(unknown)";
    let s = scripts.get(name);
    if (!s) {
      s = { requests: 0, errors: 0, wallP50: [], wallP99: [], cpuP50: [] };
      scripts.set(name, s);
    }
    s.requests += r.sum.requests;
    s.errors += r.sum.errors;
    s.wallP50.push(r.quantiles.wallTimeP50);
    s.wallP99.push(r.quantiles.wallTimeP99);
    s.cpuP50.push(r.quantiles.cpuTimeP50);
  }
  return scripts;
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ── Scan steps ────────────────────────────────────────────────────

async function overviewStep(config: AuthConfig, filter: string): Promise<void> {
  console.log(bold("1. Per-script overview"));

  const query = `{ viewer { accounts(filter: {accountTag: "${config.accountId}"}) { workersInvocationsAdaptive(limit: 200, filter: {${filter}}, orderBy: [sum_requests_DESC]) { sum { errors requests subrequests wallTime } quantiles { wallTimeP99 wallTimeP50 cpuTimeP50 cpuTimeP99 } dimensions { scriptName } } } } }`;

  const data = (await gql(config, query)) as GqlResponse;
  const rows = getRows(data);

  if (rows.length === 0) {
    console.log("  No invocations found in this period.");
    console.log();
    return;
  }

  const scripts = aggregate(rows);

  const sorted = [...scripts.entries()].sort((a, b) => b[1].requests - a[1].requests);
  for (const [name, s] of sorted) {
    const errRate = s.requests > 0 ? (s.errors / s.requests) * 100 : 0;
    const avgP50 = avg(s.wallP50) / 1000;
    const avgP99 = avg(s.wallP99) / 1000;
    const avgCpu = avg(s.cpuP50) / 1000;

    console.log(`  ${bold(name)}`);
    console.log(
      `    Requests: ${fmt(s.requests)}   Errors: ${errColor(errRate, `${fmt(s.errors)} (${errRate.toFixed(1)}%)`)}`,
    );
    console.log(
      `    Wall p50: ${avgP50.toFixed(0)}ms   ${p99Color(avgP99, `p99: ${avgP99.toFixed(0)}ms`)}   CPU p50: ${avgCpu.toFixed(0)}ms`,
    );
    console.log();
  }
}

async function statusStep(config: AuthConfig, filter: string): Promise<void> {
  console.log(bold("2. Status code distribution"));

  const query = `{ viewer { accounts(filter: {accountTag: "${config.accountId}"}) { workersInvocationsAdaptive(limit: 500, filter: {${filter}}, orderBy: [sum_requests_DESC]) { sum { requests } dimensions { scriptName status } } } } }`;

  const data = (await gql(config, query)) as GqlResponse;
  const rows = getRows(data);

  if (rows.length === 0) {
    console.log("  No data.");
    console.log();
    return;
  }

  // Group by script -> status
  const byScript = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const name = r.dimensions.scriptName || "(unknown)";
    const status = r.dimensions.status ?? "unknown";
    const reqs = r.sum.requests;
    if (!byScript.has(name)) byScript.set(name, new Map());
    const statuses = byScript.get(name)!;
    statuses.set(status, (statuses.get(status) ?? 0) + reqs);
  }

  for (const [name, statuses] of [...byScript.entries()].sort()) {
    const total = [...statuses.values()].reduce((a, b) => a + b, 0);
    const parts: string[] = [];

    for (const s of ["success", "clientError", "serverError"]) {
      const count = statuses.get(s) ?? 0;
      if (count === 0) continue;
      const pct = total > 0 ? (count / total) * 100 : 0;
      const label = `${s}=${fmt(count)} (${pct.toFixed(1)}%)`;
      if (s === "serverError") parts.push(red(label));
      else if (s === "clientError") parts.push(yellow(label));
      else parts.push(green(label));
    }

    console.log(`  ${bold(name)}  ${parts.join("  ")}`);
  }
  console.log();
}

async function errorTimelineStep(
  config: AuthConfig,
  filter: string,
): Promise<void> {
  console.log(bold("3. Error timeline"));

  for (const errType of ["serverError", "clientError"] as const) {
    const label = errType === "serverError" ? "Server errors (5xx)" : "Client errors (4xx)";
    const colorFn = errType === "serverError" ? red : yellow;
    console.log(`  ${colorFn(bold(label))}`);

    const query = `{ viewer { accounts(filter: {accountTag: "${config.accountId}"}) { workersInvocationsAdaptive(limit: 50, filter: {${filter}, status: "${errType}"}, orderBy: [datetime_DESC]) { sum { errors requests } dimensions { datetime scriptName } } } } }`;

    const data = (await gql(config, query)) as GqlResponse;
    const rows = getRows(data);

    if (rows.length === 0) {
      console.log("    None");
    } else {
      for (const r of rows) {
        const dt = r.dimensions.datetime ?? "?";
        const name = (r.dimensions.scriptName || "?").padEnd(20);
        console.log(
          `    ${dt}  ${name}  reqs=${String(r.sum.requests).padStart(4)}  errs=${String(r.sum.errors).padStart(2)}`,
        );
      }
    }
    console.log();
  }
}

async function latencyStep(
  config: AuthConfig,
  filter: string,
  stepNum: number,
): Promise<void> {
  console.log(bold(`${stepNum}. Latency breakdown (by script, top 10 slowest p99)`));

  const query = `{ viewer { accounts(filter: {accountTag: "${config.accountId}"}) { workersInvocationsAdaptive(limit: 100, filter: {${filter}}, orderBy: [quantiles_wallTimeP99_DESC]) { sum { requests } quantiles { wallTimeP50 wallTimeP99 cpuTimeP99 } dimensions { scriptName datetime } } } } }`;

  const data = (await gql(config, query)) as GqlResponse;
  const rows = getRows(data);

  if (rows.length === 0) {
    console.log("  No data.");
    console.log();
    return;
  }

  // Sort by p99 desc, take top 10
  const sorted = [...rows].sort((a, b) => b.quantiles.wallTimeP99 - a.quantiles.wallTimeP99).slice(0, 10);

  for (const r of sorted) {
    const dt = r.dimensions.datetime ?? "?";
    const name = (r.dimensions.scriptName || "?").padEnd(20);
    const p50 = r.quantiles.wallTimeP50 / 1000;
    const p99 = r.quantiles.wallTimeP99 / 1000;
    const cpu99 = r.quantiles.cpuTimeP99 / 1000;
    const reqs = r.sum.requests;

    console.log(
      `  ${dt}  ${name}  reqs=${String(reqs).padStart(4)}  wall ${p99Color(p99, `p99=${p99.toFixed(0)}ms`)}  p50=${p50.toFixed(0)}ms  cpu_p99=${cpu99.toFixed(0)}ms`,
    );
  }
  console.log();
}

async function summaryStep(
  config: AuthConfig,
  filter: string,
  stepNum: number,
  period: string,
): Promise<void> {
  console.log(bold(`${stepNum}. Investigation summary`));

  const query = `{ viewer { accounts(filter: {accountTag: "${config.accountId}"}) { workersInvocationsAdaptive(limit: 200, filter: {${filter}}) { sum { errors requests } quantiles { wallTimeP99 } dimensions { scriptName status } } } } }`;

  const data = (await gql(config, query)) as GqlResponse;
  const rows = getRows(data);

  if (rows.length === 0) {
    console.log("  Could not generate summary.");
    console.log();
    return;
  }

  const scriptsWith5xx = new Set<string>();
  const scriptsWithHighLatency = new Set<string>();

  for (const r of rows) {
    const name = r.dimensions.scriptName || "(unknown)";
    const status = r.dimensions.status;
    const reqs = r.sum.requests;
    const p99 = r.quantiles.wallTimeP99 / 1000;

    if (status === "serverError" && reqs > 0) {
      scriptsWith5xx.add(name);
    }
    if (p99 > 5000 && reqs > 5) {
      scriptsWithHighLatency.add(name);
    }
  }

  if (scriptsWith5xx.size > 0) {
    for (const s of [...scriptsWith5xx].sort()) {
      console.log(
        `  ${red("!!")} ${bold(s)} has server errors (5xx) -- run with --errors for timeline`,
      );
    }
    console.log();
  }

  if (scriptsWithHighLatency.size > 0) {
    for (const s of [...scriptsWithHighLatency].sort()) {
      console.log(
        `  ${yellow("!!")} ${bold(s)} has p99 wall time > 5s -- possible timeouts or slow upstreams`,
      );
    }
    console.log();
  }

  if (scriptsWith5xx.size === 0 && scriptsWithHighLatency.size === 0) {
    console.log(green("  All clear") + " -- no error spikes or latency anomalies detected.");
    console.log();
  }

  const targets = new Set([...scriptsWith5xx, ...scriptsWithHighLatency]);
  if (targets.size > 0) {
    for (const t of [...targets].sort()) {
      console.log(`  ${bold("Next step:")} cfcontrail logs --project ${t} --period ${period}`);
    }
  }
  console.log();
}

// ── Main scan entry point ─────────────────────────────────────────

export async function doScan(opts: ScanOptions): Promise<void> {
  const from = periodToFrom(opts.period);
  const now = nowISO();
  const filter = buildFilter(from, now, opts.filterName);

  console.log(`${bold(cyan("Contrail -- Scan"))}`);
  console.log(dim(`Period: ${opts.period} (${from} -> ${now})`));
  if (opts.filterName) {
    console.log(dim(`Filter: scriptName = ${opts.filterName}`));
  } else {
    console.log(dim("Filter: all workers/pages"));
  }
  console.log();

  await overviewStep(opts.config, filter);
  await statusStep(opts.config, filter);

  let stepNum = 3;
  if (opts.errorsOnly) {
    await errorTimelineStep(opts.config, filter);
    stepNum = 4;
  }

  await latencyStep(opts.config, filter, stepNum);
  await summaryStep(opts.config, filter, stepNum + 1, opts.period);
}
