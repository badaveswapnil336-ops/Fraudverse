// Tests for the demo-mode helpers.
// Run:  npx tsx --test lib/demo.test.ts     (from the frontend folder)

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEMO_RUNS, frictionRate, predictedFromProposal, sameTraffic, summarize } from "./demo";
import type { Proposal, Scorecard } from "./types";

function card(over: {
  campaigns: number;
  caught: number;
  payments: number;
  letThrough: number;
  genuine: number;
  blocked: number;
  challenged: number;
}): Scorecard {
  return {
    attacks: {
      campaigns: over.campaigns,
      campaigns_caught: over.caught,
      payments: over.payments,
      amount_let_through: over.letThrough,
    },
    genuine: { payments: over.genuine, blocked: over.blocked, challenged: over.challenged },
  } as unknown as Scorecard;
}

describe("summarize", () => {
  it("adds up across runs", () => {
    const totals = summarize([
      card({ campaigns: 10, caught: 9, payments: 40, letThrough: 100, genuine: 300, blocked: 6, challenged: 3 }),
      card({ campaigns: 5, caught: 5, payments: 20, letThrough: 50, genuine: 200, blocked: 4, challenged: 2 }),
    ]);
    assert.equal(totals.runs, 2);
    assert.equal(totals.campaigns, 15);
    assert.equal(totals.campaignsCaught, 14);
    assert.equal(totals.fraudPayments, 60);
    assert.equal(totals.amountLetThrough, 150);
    assert.equal(totals.genuinePayments, 500);
    assert.equal(totals.genuineBlocked, 10);
    assert.equal(totals.genuineChallenged, 5);
  });

  it("handles no runs", () => {
    const totals = summarize([]);
    assert.equal(totals.runs, 0);
    assert.equal(frictionRate(totals), null);
  });
});

describe("frictionRate", () => {
  it("is blocked plus challenged over genuine payments", () => {
    const totals = summarize([
      card({ campaigns: 1, caught: 1, payments: 1, letThrough: 0, genuine: 200, blocked: 6, challenged: 4 }),
    ]);
    assert.equal(frictionRate(totals), 0.05);
  });
});

describe("sameTraffic", () => {
  const a = summarize([card({ campaigns: 3, caught: 2, payments: 9, letThrough: 5, genuine: 90, blocked: 4, challenged: 1 })]);

  it("is true when only decisions differ", () => {
    const b = summarize([card({ campaigns: 3, caught: 3, payments: 9, letThrough: 0, genuine: 90, blocked: 1, challenged: 0 })]);
    assert.equal(sameTraffic(a, b), true);
  });

  it("is false when the traffic itself differs", () => {
    const b = summarize([card({ campaigns: 4, caught: 3, payments: 9, letThrough: 0, genuine: 90, blocked: 1, challenged: 0 })]);
    assert.equal(sameTraffic(a, b), false);
  });
});

describe("predictedFromProposal", () => {
  const set = (caught: number, letThrough: number) => ({
    after: { campaigns_caught: caught, amount_let_through: letThrough },
  });
  const proposal = { impact: [set(5, 10), set(4, 20), set(3, 30)] } as unknown as Proposal;

  it("adds the after-values of every measured set", () => {
    assert.deepEqual(predictedFromProposal(proposal, 3), { campaignsCaught: 12, amountLetThrough: 60 });
  });

  it("refuses a proposal that was not measured on every demo run", () => {
    assert.equal(predictedFromProposal(proposal, 2), null);
  });
});

describe("DEMO_RUNS", () => {
  it("uses distinct fixed seeds", () => {
    const seeds = DEMO_RUNS.map((run) => run.seed);
    assert.equal(new Set(seeds).size, seeds.length);
    assert.ok(seeds.every((seed) => Number.isInteger(seed) && seed >= 0));
  });
});
