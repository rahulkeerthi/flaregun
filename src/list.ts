// List mode — discover all Workers/Pages with recent activity

import { type AuthConfig, gql } from "./api.js";
import {
  bold,
  cyan,
  dim,
  red,
  yellow,
  healthColor,
  fmt,
  hr,
} from "./format.js";
import { type Period, periodToFrom, nowISO } from "./time.js";

interface ListOptions {
  config: AuthConfig;
  period: Period;
}

interface GqlResponse {
  data?: {
    viewer?: {
      accounts?: Array<{
        workersInvocationsAdaptive?: Array<{
          sum: { requests: number; errors: number; subrequests: number };
          quantiles: { wallTimeP50: number; wallTimeP99: number; cpuTimeP50: number };
          dimensions: { scriptName: string };
        }>;
      }>;
    };
  };
}

interface ScriptAgg {
  requests: number;
  errors: number;
  wallP50: number[];
  wallP99: number[];
  cpuP50: number[];
}

export async function doList(opts: ListOptions): Promise<void> {
  const period = opts.period || "7d";
  const from = periodToFrom(period);
  const now = nowISO();

  console.log(`${bold(cyan("Flaregun -- List Projects"))}`);
  console.log(dim(`Showing workers/pages with activity in the last ${period}`));
  console.log();

  const query = `{ viewer { accounts(filter: {accountTag: "${opts.config.accountId}"}) { workersInvocationsAdaptive(limit: 500, filter: {datetime_gt: "${from}", datetime_lt: "${now}"}, orderBy: [sum_requests_DESC]) { sum { requests errors subrequests } quantiles { wallTimeP50 wallTimeP99 cpuTimeP50 } dimensions { scriptName } } } } }`;

  let data: GqlResponse;
  try {
    data = (await gql(opts.config, query)) as GqlResponse;
  } catch (e) {
    console.error(red(`Error fetching project list: ${(e as Error).message}`));
    return;
  }

  const rows = data.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? [];

  if (rows.length === 0) {
    console.log(yellow("No worker/pages activity found in this period."));
    return;
  }

  // Aggregate by scriptName
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

  // Header
  const nameW = 28;
  const header = `  ${bold("Name".padEnd(nameW))} ${bold("Requests".padStart(10))} ${bold("Errors".padStart(8))} ${bold("Err%".padStart(6))} ${bold("p50".padStart(7))} ${bold("p99".padStart(7))}`;
  console.log(header);
  hr(72);

  const sorted = [...scripts.entries()].sort((a, b) => b[1].requests - a[1].requests);

  for (const [name, s] of sorted) {
    const errRate = s.requests > 0 ? (s.errors / s.requests) * 100 : 0;
    const avgP50 =
      s.wallP50.length > 0
        ? s.wallP50.reduce((a, b) => a + b, 0) / s.wallP50.length / 1000
        : 0;
    const avgP99 =
      s.wallP99.length > 0
        ? s.wallP99.reduce((a, b) => a + b, 0) / s.wallP99.length / 1000
        : 0;

    const coloredName = healthColor(errRate, avgP99, name.padEnd(nameW));
    const errStr = s.errors > 0 ? fmt(s.errors) : dim("0");
    const rateStr = errRate > 0 ? `${errRate.toFixed(1)}%` : dim("0%");

    console.log(
      `  ${coloredName} ${fmt(s.requests).padStart(10)} ${errStr.padStart(8)} ${rateStr.padStart(6)} ${`${avgP50.toFixed(0)}ms`.padStart(7)} ${`${avgP99.toFixed(0)}ms`.padStart(7)}`,
    );
  }

  console.log();
  console.log(dim("Use: flaregun scan --project <name> to scan a specific project"));
  console.log(dim("     flaregun logs --project <name> for detailed logs"));
}
