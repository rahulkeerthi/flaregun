import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { loadAuthFromEnv } from "./api.js";

// Save and restore env between tests
let savedEnv: Record<string, string | undefined>;

const CF_VARS = [
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_EMAIL",
  "CLOUDFLARE_API_KEY",
  "CLOUDFLARE_LOGS_API_KEY",
];

beforeEach(() => {
  savedEnv = {};
  for (const k of CF_VARS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of CF_VARS) {
    if (savedEnv[k] !== undefined) {
      process.env[k] = savedEnv[k];
    } else {
      delete process.env[k];
    }
  }
});

describe("loadAuthFromEnv", () => {
  it("throws when CLOUDFLARE_ACCOUNT_ID is missing", () => {
    assert.throws(() => loadAuthFromEnv(), /CLOUDFLARE_ACCOUNT_ID not set/);
  });

  it("throws when account ID is set but no auth credentials", () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "abc123";
    assert.throws(() => loadAuthFromEnv(), /Set CLOUDFLARE_API_TOKEN/);
  });

  it("accepts API token auth", () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "abc123";
    process.env.CLOUDFLARE_API_TOKEN = "my-token";

    const config = loadAuthFromEnv();
    assert.strictEqual(config.accountId, "abc123");
    assert.strictEqual(config.apiToken, "my-token");
    assert.strictEqual(config.email, undefined);
    assert.strictEqual(config.apiKey, undefined);
  });

  it("accepts email + API key auth", () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "abc123";
    process.env.CLOUDFLARE_EMAIL = "user@example.com";
    process.env.CLOUDFLARE_API_KEY = "global-key";

    const config = loadAuthFromEnv();
    assert.strictEqual(config.accountId, "abc123");
    assert.strictEqual(config.apiToken, undefined);
    assert.strictEqual(config.email, "user@example.com");
    assert.strictEqual(config.apiKey, "global-key");
  });

  it("rejects email without API key", () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "abc123";
    process.env.CLOUDFLARE_EMAIL = "user@example.com";
    // No API key
    assert.throws(() => loadAuthFromEnv(), /Set CLOUDFLARE_API_TOKEN/);
  });

  it("rejects API key without email", () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "abc123";
    process.env.CLOUDFLARE_API_KEY = "global-key";
    // No email
    assert.throws(() => loadAuthFromEnv(), /Set CLOUDFLARE_API_TOKEN/);
  });

  it("includes logs API key when set", () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "abc123";
    process.env.CLOUDFLARE_API_TOKEN = "my-token";
    process.env.CLOUDFLARE_LOGS_API_KEY = "logs-token";

    const config = loadAuthFromEnv();
    assert.strictEqual(config.logsApiKey, "logs-token");
  });

  it("sets logsApiKey to undefined when not set", () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "abc123";
    process.env.CLOUDFLARE_API_TOKEN = "my-token";

    const config = loadAuthFromEnv();
    assert.strictEqual(config.logsApiKey, undefined);
  });
});
