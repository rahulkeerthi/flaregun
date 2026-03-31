import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isValidPeriod,
  toISO,
  isoToEpochMs,
  epochMsToTime,
  epochMsToDatetime,
} from "./time.js";

describe("isValidPeriod", () => {
  it("accepts valid periods", () => {
    for (const p of ["1h", "6h", "24h", "7d", "30d"]) {
      assert.strictEqual(isValidPeriod(p), true, `${p} should be valid`);
    }
  });

  it("rejects invalid periods", () => {
    for (const p of ["2h", "12h", "1d", "7", "h", "", "1w"]) {
      assert.strictEqual(isValidPeriod(p), false, `${p} should be invalid`);
    }
  });
});

describe("toISO", () => {
  it("formats a date without milliseconds", () => {
    const d = new Date("2026-03-31T10:30:00.123Z");
    assert.strictEqual(toISO(d), "2026-03-31T10:30:00Z");
  });

  it("handles midnight", () => {
    const d = new Date("2026-01-01T00:00:00.000Z");
    assert.strictEqual(toISO(d), "2026-01-01T00:00:00Z");
  });

  it("handles end of day", () => {
    const d = new Date("2026-12-31T23:59:59.999Z");
    assert.strictEqual(toISO(d), "2026-12-31T23:59:59Z");
  });
});

describe("isoToEpochMs", () => {
  it("converts ISO string to epoch milliseconds", () => {
    assert.strictEqual(isoToEpochMs("2026-01-01T00:00:00Z"), 1767225600000);
  });

  it("roundtrips with toISO", () => {
    const iso = "2026-06-15T12:30:45Z";
    const ms = isoToEpochMs(iso);
    const back = toISO(new Date(ms));
    assert.strictEqual(back, iso);
  });

  it("handles ISO strings with milliseconds", () => {
    const ms = isoToEpochMs("2026-01-01T00:00:00.500Z");
    assert.strictEqual(ms, 1767225600500);
  });
});

describe("epochMsToTime", () => {
  it("formats as HH:MM:SS", () => {
    const ms = new Date("2026-03-31T14:05:09Z").getTime();
    assert.strictEqual(epochMsToTime(ms), "14:05:09");
  });

  it("handles midnight", () => {
    const ms = new Date("2026-01-01T00:00:00Z").getTime();
    assert.strictEqual(epochMsToTime(ms), "00:00:00");
  });
});

describe("epochMsToDatetime", () => {
  it("formats as YYYY-MM-DD HH:MM:SS", () => {
    const ms = new Date("2026-03-31T14:05:09Z").getTime();
    assert.strictEqual(epochMsToDatetime(ms), "2026-03-31 14:05:09");
  });
});
