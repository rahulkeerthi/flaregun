// Cloudflare API client — GraphQL + REST, auth handling

export interface AuthConfig {
  accountId: string;
  /** Bearer token auth (preferred) */
  apiToken?: string;
  /** Email + Global API Key auth (fallback) */
  email?: string;
  apiKey?: string;
  /** Separate token for telemetry/observability API */
  logsApiKey?: string;
}

const GQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";
const REST_BASE = "https://api.cloudflare.com/client/v4";

function getAuthHeaders(config: AuthConfig): Record<string, string> {
  if (config.apiToken) {
    return { Authorization: `Bearer ${config.apiToken}` };
  }
  if (config.email && config.apiKey) {
    return {
      "X-Auth-Email": config.email,
      "X-Auth-Key": config.apiKey,
    };
  }
  throw new Error("No valid auth configured. Set CLOUDFLARE_API_TOKEN or CLOUDFLARE_EMAIL + CLOUDFLARE_API_KEY.");
}

function getLogsAuthHeaders(config: AuthConfig): Record<string, string> {
  if (config.logsApiKey) {
    return { Authorization: `Bearer ${config.logsApiKey}` };
  }
  return getAuthHeaders(config);
}

/** Send a GraphQL query to the Cloudflare Analytics API */
export async function gql(config: AuthConfig, query: string): Promise<unknown> {
  const res = await fetch(GQL_ENDPOINT, {
    method: "POST",
    headers: {
      ...getAuthHeaders(config),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    throw new Error(`GraphQL API error: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

/** Send a REST API request */
export async function cfApi(
  config: AuthConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const url = `${REST_BASE}${path}`;
  const headers: Record<string, string> = {
    ...getAuthHeaders(config),
    "Content-Type": "application/json",
  };

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`REST API error: ${res.status} ${res.statusText}\n${text}`);
  }

  return res.json();
}

/** Send a REST API request using logs-specific auth */
export async function cfLogsApi(
  config: AuthConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const url = `${REST_BASE}${path}`;
  const headers: Record<string, string> = {
    ...getLogsAuthHeaders(config),
    "Content-Type": "application/json",
  };

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Logs API error: ${res.status} ${res.statusText}\n${text}`);
  }

  return res.json();
}

/** Load auth config from environment variables */
export function loadAuthFromEnv(): AuthConfig {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!accountId) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID not set. Add it to .env or export it.");
  }

  const apiToken = process.env.CLOUDFLARE_API_TOKEN || undefined;
  const email = process.env.CLOUDFLARE_EMAIL || undefined;
  const apiKey = process.env.CLOUDFLARE_API_KEY || undefined;
  const logsApiKey = process.env.CLOUDFLARE_LOGS_API_KEY || undefined;

  if (!apiToken && !(email && apiKey)) {
    throw new Error(
      "Set CLOUDFLARE_API_TOKEN or both CLOUDFLARE_EMAIL + CLOUDFLARE_API_KEY in .env",
    );
  }

  return { accountId, apiToken, email, apiKey, logsApiKey };
}
