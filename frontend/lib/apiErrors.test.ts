// Tests for the request-failure messages.
// Run:  npx tsx --test lib/apiErrors.test.ts     (from the frontend folder)

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TIMEOUT_MS, describeFetchFailure } from "./apiErrors";

describe("describeFetchFailure", () => {
  it("says the backend is unreachable and where it looked", () => {
    const message = describeFetchFailure("http://127.0.0.1:8000", false, 30_000);
    assert.match(message, /Cannot reach the Fraudverse backend at http:\/\/127\.0\.0\.1:8000/);
    assert.match(message, /running/);
  });

  it("says how long it waited when a request timed out", () => {
    const message = describeFetchFailure("http://127.0.0.1:8000", true, 30_000);
    assert.match(message, /did not answer within 30 seconds/);
    assert.doesNotMatch(message, /Cannot reach/);
  });

  it("never reports less than one second", () => {
    assert.match(describeFetchFailure("x", true, 100), /within 1 seconds/);
  });

  it("does not leak a raw browser message", () => {
    assert.doesNotMatch(describeFetchFailure("x", false, 1000), /Failed to fetch/i);
  });
});

describe("TIMEOUT_MS", () => {
  it("gives long jobs more time than reads", () => {
    assert.ok(TIMEOUT_MS.read < TIMEOUT_MS.advisor && TIMEOUT_MS.advisor < TIMEOUT_MS.launch);
  });
});
