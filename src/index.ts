#!/usr/bin/env node

// CLI entry point — arg parsing, dispatch

import "dotenv/config";
import { loadAuthFromEnv } from "./api.js";
import { doScan } from "./scan.js";
import { doLogs } from "./logs.js";
import { doList } from "./list.js";
import { isValidPeriod, type Period } from "./time.js";
import { red, bold } from "./format.js";

// ── Help text ─────────────────────────────────────────────────────

const HELP = `
${bold("flaregun")} -- fire a flare to find what's wrong with your Cloudflare Workers

${bold("USAGE")}
  flaregun [command] [flags]

${bold("COMMANDS")}
  scan                     Scan for anomalies (default if no command given)
  logs                     Pull detailed per-request logs
  list                     List all Workers/Pages with recent activity

${bold("SCAN FLAGS")}
  --period <1h|6h|24h|7d|30d>   Time window to scan (default: 1h)
  --project <name>               Filter to a Pages project (e.g. myteam-www)
  --script <name>                Filter to a Worker script name
  --errors                       Focus only on error status codes

${bold("LOG FLAGS")}
  --since <ISO datetime>   Start time for logs (default: uses --period)
  --limit <n>              Max events to fetch (default: 50)
  --project / --script     Filter as above

${bold("GENERAL")}
  --help, -h               Show this help

${bold("ENVIRONMENT")}
  CLOUDFLARE_ACCOUNT_ID    Required. Your Cloudflare account ID.
  CLOUDFLARE_API_TOKEN     Bearer token auth (preferred).
  CLOUDFLARE_EMAIL         Email for Global API Key auth.
  CLOUDFLARE_API_KEY       Global API Key.
  CLOUDFLARE_LOGS_API_KEY  Separate token for telemetry API (optional).

  Reads from .env file in the current directory automatically.

${bold("EXAMPLES")}
  flaregun                                     # scan all workers, last 1h
  flaregun scan --project myteam-www --period 6h
  flaregun scan --errors --period 24h
  flaregun logs --project myteam-www
  flaregun logs --project myteam-www --since "2026-03-31T10:00:00Z"
  flaregun list --period 30d
`;

// ── Arg parsing ───────────────────────────────────────────────────

interface CliArgs {
  mode: "scan" | "logs" | "list";
  period: Period;
  project: string | null;
  scriptName: string | null;
  errorsOnly: boolean;
  since: string | null;
  limit: number;
}

function parseArgs(argv: string[]): CliArgs | null {
  const args: CliArgs = {
    mode: "scan",
    period: "1h",
    project: null,
    scriptName: null,
    errorsOnly: false,
    since: null,
    limit: 50,
  };

  // The first positional arg (if not a flag) is the command
  let i = 0;

  // Check if first arg is a command
  if (argv.length > 0 && !argv[0].startsWith("-")) {
    const cmd = argv[0];
    if (cmd === "scan" || cmd === "logs" || cmd === "list") {
      args.mode = cmd;
      i = 1;
    } else if (cmd === "help") {
      return null; // trigger help
    }
  }

  while (i < argv.length) {
    const flag = argv[i];

    switch (flag) {
      case "--help":
      case "-h":
        return null; // trigger help

      case "--logs":
        args.mode = "logs";
        i++;
        break;

      case "--list":
        args.mode = "list";
        i++;
        break;

      case "--errors":
        args.errorsOnly = true;
        i++;
        break;

      case "--period": {
        const val = argv[++i];
        if (!val || !isValidPeriod(val)) {
          console.error(red(`Unknown period: ${val ?? "(empty)"} (use 1h, 6h, 24h, 7d, 30d)`));
          process.exit(1);
        }
        args.period = val as Period;
        i++;
        break;
      }

      case "--project": {
        const val = argv[++i];
        if (!val) {
          console.error(red("--project requires a value"));
          process.exit(1);
        }
        args.project = val;
        i++;
        break;
      }

      case "--script": {
        const val = argv[++i];
        if (!val) {
          console.error(red("--script requires a value"));
          process.exit(1);
        }
        args.scriptName = val;
        i++;
        break;
      }

      case "--since": {
        const val = argv[++i];
        if (!val) {
          console.error(red("--since requires a value"));
          process.exit(1);
        }
        args.since = val;
        i++;
        break;
      }

      case "--limit": {
        const val = argv[++i];
        if (!val || Number.isNaN(Number(val))) {
          console.error(red("--limit requires a numeric value"));
          process.exit(1);
        }
        args.limit = Number(val);
        i++;
        break;
      }

      default:
        console.error(red(`Unknown flag: ${flag}`));
        console.log(HELP);
        process.exit(1);
    }
  }

  return args;
}

// ── Main ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Skip the first two entries (node binary and script path)
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (!args) {
    console.log(HELP);
    process.exit(0);
  }

  // Load auth
  let config;
  try {
    config = loadAuthFromEnv();
  } catch (e) {
    console.error(red((e as Error).message));
    process.exit(1);
  }

  // Resolve filter: --script takes precedence, --project is fallback
  const filterName = args.scriptName ?? args.project;

  switch (args.mode) {
    case "scan":
      await doScan({
        config,
        period: args.period,
        filterName,
        errorsOnly: args.errorsOnly,
      });
      break;

    case "logs":
      await doLogs({
        config,
        period: args.period,
        filterName,
        since: args.since,
        limit: args.limit,
        onFallbackToScan: () =>
          doScan({
            config,
            period: args.period,
            filterName,
            errorsOnly: args.errorsOnly,
          }),
      });
      break;

    case "list":
      await doList({
        config,
        period: args.period,
      });
      break;
  }
}

main().catch((e) => {
  console.error(red(`Fatal error: ${(e as Error).message}`));
  process.exit(1);
});
