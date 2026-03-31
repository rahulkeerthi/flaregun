# flaregun

Fire a flare to find what's wrong with your Cloudflare Workers and Pages.

Three modes:

1. **`list`** -- discover all Workers/Pages with recent activity
2. **`scan`** -- scan for error spikes, latency anomalies, status distributions
3. **`logs`** -- pull detailed per-request logs from Workers Observability

## Install

```bash
npx flaregun
```

Or install globally:

```bash
npm install -g flaregun
flaregun
```

## Usage

```bash
# List all projects with recent activity
flaregun list

# Scan all workers for the last hour (default)
flaregun scan

# Scan a specific project over 6 hours
flaregun scan --project myteam-www --period 6h

# Focus on errors only
flaregun scan --errors --period 24h

# Pull detailed per-request logs
flaregun logs --project footyapps

# Logs from a specific time
flaregun logs --project footyapps --since "2026-03-31T10:00:00Z"
```

## Environment variables

Create a `.env` file in the directory you run the command from, or export these:

| Variable | Required | Description |
|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Yes | Your Cloudflare account ID |
| `CLOUDFLARE_API_TOKEN` | Yes* | Bearer token (preferred auth method) |
| `CLOUDFLARE_EMAIL` | Yes* | Email for Global API Key auth |
| `CLOUDFLARE_API_KEY` | Yes* | Global API Key |
| `CLOUDFLARE_LOGS_API_KEY` | No | Separate token scoped for telemetry API |

*Either `CLOUDFLARE_API_TOKEN` or both `CLOUDFLARE_EMAIL` + `CLOUDFLARE_API_KEY` are required.

## Flags

| Flag | Default | Description |
|---|---|---|
| `--period <1h\|6h\|24h\|7d\|30d>` | `1h` | Time window |
| `--project <name>` | | Filter to a Pages project |
| `--script <name>` | | Filter to a Worker script name |
| `--errors` | | Show error timeline (scan mode) |
| `--since <ISO>` | | Start time for logs |
| `--limit <n>` | `50` | Max events to fetch (logs mode) |

## Prerequisites for logs mode

Workers must have observability enabled:

```toml
# wrangler.toml
[observability]
enabled = true
```

Flaregun checks for this automatically and offers to add it if missing.

## Security

**Use scoped API tokens, not Global API Keys.** A scoped token with `Account Analytics:Read` and `Workers Scripts:Read` is all flaregun needs. Global API Keys (`CLOUDFLARE_API_KEY`) grant full account access and should be a last resort.

**Don't commit `.env` files.** If you use flaregun in CI, pass credentials via environment variables rather than `.env` files in the repo.

**Output may contain sensitive data.** The `logs` mode prints request URLs, exception messages, and console output from your workers. These can contain query parameters, session tokens, or PII. Don't pipe output to shared logs or issue trackers without review.

**Input validation.** Project and script names are validated against a strict allowlist (`[a-zA-Z0-9_\-\.]`) to prevent injection into API queries. `--limit` is capped at 1000.

## How it works

- **list** and **scan** use the Cloudflare GraphQL Analytics API (`workersInvocationsAdaptive`) -- works on all plans, no setup needed
- **logs** uses the Workers Observability Telemetry API -- requires `[observability] enabled = true` and a redeploy

## License

MIT
