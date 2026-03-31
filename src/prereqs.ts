// Pre-requisite checks — auth verification, observability config detection

import { readFileSync, existsSync } from "node:fs";
import { type AuthConfig, cfApi } from "./api.js";
import { red, green, yellow, dim } from "./format.js";

interface AuthCheckResult {
  ok: boolean;
  accountName?: string;
  error?: string;
}

/** Verify credentials by hitting GET /accounts/{id} */
export async function checkAuth(config: AuthConfig): Promise<AuthCheckResult> {
  try {
    const data = (await cfApi(config, "GET", `/accounts/${config.accountId}`)) as {
      success?: boolean;
      result?: { name?: string };
      errors?: Array<{ code?: number; message?: string }>;
    };

    if (data.success) {
      return { ok: true, accountName: data.result?.name ?? "unknown" };
    }

    const err = data.errors?.[0];
    return {
      ok: false,
      error: `${err?.code ?? 0}: ${err?.message ?? "unknown"}`,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Print auth check result. Returns true if OK. */
export async function printAuthCheck(config: AuthConfig): Promise<boolean> {
  const result = await checkAuth(config);

  if (!result.ok) {
    console.log(`  ${red("Auth failed:")} ${result.error}`);
    if (result.error?.includes("Authentication") || result.error?.includes("9109")) {
      console.log(dim("  Your API token may lack Account-level permissions."));
      console.log(dim("  The telemetry API requires a token with Workers Scripts:Read on the account."));
      console.log(dim("  If using a Global API Key, check CLOUDFLARE_EMAIL + CLOUDFLARE_API_KEY in .env."));
    }
    console.log();
    return false;
  }

  console.log(`  ${green("Auth OK")} -- account: ${result.accountName}`);
  return true;
}

interface ObservabilityCheck {
  found: boolean;
  configFile?: string;
}

/** Check for [observability] in local wrangler config files */
export function checkLocalObservability(): ObservabilityCheck {
  // Check wrangler.toml
  if (existsSync("wrangler.toml")) {
    try {
      const content = readFileSync("wrangler.toml", "utf-8");
      if (/^\[observability\]/m.test(content)) {
        return { found: true, configFile: "wrangler.toml" };
      }
      return { found: false, configFile: "wrangler.toml" };
    } catch {
      return { found: false, configFile: "wrangler.toml" };
    }
  }

  // Check wrangler.jsonc / wrangler.json
  for (const file of ["wrangler.jsonc", "wrangler.json"]) {
    if (existsSync(file)) {
      try {
        const content = readFileSync(file, "utf-8");
        if (content.includes('"observability"')) {
          return { found: true, configFile: file };
        }
        return { found: false, configFile: file };
      } catch {
        return { found: false, configFile: file };
      }
    }
  }

  return { found: false };
}

/** Get the project name from local wrangler config */
export function getLocalProjectName(): string | null {
  if (existsSync("wrangler.toml")) {
    try {
      const content = readFileSync("wrangler.toml", "utf-8");
      const match = content.match(/^name\s*=\s*"?([^"\n]+)"?/m);
      return match?.[1]?.trim() ?? null;
    } catch {
      return null;
    }
  }

  for (const file of ["wrangler.jsonc", "wrangler.json"]) {
    if (existsSync(file)) {
      try {
        const content = readFileSync(file, "utf-8");
        // Strip single-line comments for jsonc
        const stripped = content.replace(/\/\/.*/g, "");
        const parsed = JSON.parse(stripped) as { name?: string };
        return parsed.name ?? null;
      } catch {
        return null;
      }
    }
  }

  return null;
}

/** Print observability check. Only checks when targeting local project. */
export function printObservabilityCheck(filterName: string | null): void {
  const localProject = getLocalProjectName();

  // Only check if no filter, or filter matches local project
  if (filterName && filterName !== localProject) {
    console.log(dim(`  Targeting remote project '${filterName}' -- skipping local observability check`));
    return;
  }

  const check = checkLocalObservability();

  if (check.found) {
    console.log(`  ${green("[observability] found in local wrangler config")}`);
  } else if (check.configFile) {
    console.log(`  ${yellow(`[observability] not found in ${check.configFile}`)}`);
    console.log(dim("  Workers Logs requires this setting to be enabled and the worker redeployed."));
    console.log(dim("  Add to wrangler.toml:  [observability]"));
    console.log(dim("                        enabled = true"));
  } else {
    console.log(dim("  No local wrangler config found -- skipping observability check"));
  }
}
