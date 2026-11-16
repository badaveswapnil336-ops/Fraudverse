// Tests for the pure helpers behind the Policy Advisor screen.
// Run:  npx tsx --test lib/advisorUtils.test.ts     (from the frontend folder)

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  approvedParams,
  errorMessage,
  formatDelta,
  formatParam,
  money,
  paramLabel,
  parseAdvisorReply,
  pct,
  runTitle,
  secs,
  tradeoffPoints,
  verdictTone,
} from "./advisorUtils";
import type { Headline, ImpactSet, PolicyChange } from "./types";

const headline = (friction: number | null, caught: number | null): Headline => ({
  campaigns: 10,
  campaigns_caught: 5,
  campaign_catch_rate: caught,
  payment_stop_rate: 0.5,
  median_ttd_sec: 30,
  amount_let_through: 100,
  genuine_block_rate: 0,
  genuine_challenge_rate: friction,
  genuine_friction_rate: friction,
  friction_by_scenario: {},
});

const cost = { total: 1, fraud_loss: 1, false_decline_loss: 0, challenge_cost: 0, friction_rate: 0 };

describe("formatting", () => {
  it("formats percentages, seconds and money", () => {
    assert.equal(pct(0.1234), "12.3%");
    assert.equal(pct(0.1234, 0), "12%");
    assert.equal(pct(null), "–");
    assert.equal(pct(undefined), "–");
    assert.equal(secs(45.4), "45s");
    assert.equal(secs(119), "119s");
    assert.equal(secs(120), "2.0 min");
    assert.equal(secs(null), "–");
    assert.equal(money(1234567), "Rs 12,34,567");
    assert.equal(money(null), "–");
  });

  it("names and formats policy parameters", () => {
    assert.equal(formatParam("supervised_weight", 0.7), "70 / 30");
    assert.equal(formatParam("supervised_weight", 0.9), "90 / 10");
    assert.equal(formatParam("verify_threshold", 0.5), "0.50");
    assert.equal(paramLabel("verify_threshold"), "Challenge (verify) from score");
    assert.equal(paramLabel("something_new"), "something new");
    assert.equal(runTitle("tuning"), "Tuning run");
    assert.equal(runTitle("RUN-AB12"), "Other run RUN-AB12");
  });
});

describe("formatDelta", () => {
  it("marks an increase as good when higher is better", () => {
    assert.deepEqual(formatDelta(0.5, 0.75, "pct", false), { text: "+25.0 pts", tone: "good" });
  });
  it("marks an increase as bad when lower is better", () => {
    assert.deepEqual(formatDelta(0.01, 0.05, "pct", true), { text: "+4.0 pts", tone: "bad" });
  });
  it("marks a decrease as good when lower is better", () => {
    assert.deepEqual(formatDelta(2000, 500, "money", true), { text: "−Rs 1,500", tone: "good" });
    assert.deepEqual(formatDelta(180, 58, "secs", true), { text: "−2.0 min", tone: "good" });
  });
  it("treats tiny changes as no change and missing values as dashes", () => {
    assert.deepEqual(formatDelta(0.5, 0.50001, "pct", false), { text: "no change", tone: "flat" });
    assert.deepEqual(formatDelta(null, 0.5, "pct", false), { text: "–", tone: "flat" });
    assert.deepEqual(formatDelta(0.5, undefined, "money", true), { text: "–", tone: "flat" });
  });
});

describe("approvedParams", () => {
  const changes = ["a", "b", "c"].map(
    (param): PolicyChange => ({ param, from: 0, to: 1, why: "", worth_on_tuning_run: null }),
  );
  it("returns undefined when everything is selected", () => {
    assert.equal(approvedParams(changes, new Set(["a", "b", "c"])), undefined);
  });
  it("returns only the selected parameters, in proposal order", () => {
    assert.deepEqual(approvedParams(changes, new Set(["c", "a"])), ["a", "c"]);
  });
  it("returns an empty list when nothing is selected", () => {
    assert.deepEqual(approvedParams(changes, new Set()), []);
  });
  it("ignores selections that are not part of the proposal", () => {
    assert.deepEqual(approvedParams(changes, new Set(["a", "zzz"])), ["a"]);
  });
});

describe("parseAdvisorReply", () => {
  const body = '{"summary":"Lower the bar.","changes":[{"param":"verify_threshold","to":0.5,"why":"catch more"}]}';

  it("reads plain JSON", () => {
    assert.deepEqual(parseAdvisorReply(body), {
      summary: "Lower the bar.",
      changes: [{ param: "verify_threshold", to: 0.5, why: "catch more" }],
    });
  });

  it("reads JSON inside a code fence with chatter around it", () => {
    const reply = `Sure {here} is my advice:\n\`\`\`json\n${body}\n\`\`\`\nHope that helps [1].`;
    assert.equal(parseAdvisorReply(reply).changes[0].param, "verify_threshold");
  });

  it("reads JSON after chatter that contains braces, without a fence", () => {
    const reply = `My view {briefly}: ${body}`;
    assert.equal(parseAdvisorReply(reply).changes[0].to, 0.5);
  });

  it("accepts a bare list of changes and numbers written as text", () => {
    const out = parseAdvisorReply('[{"param":"supervised_weight","to":"0.8"}]');
    assert.deepEqual(out, { changes: [{ param: "supervised_weight", to: 0.8 }] });
  });

  it("rejects replies that cannot be used, with a clear message", () => {
    const bad: Array<[string, RegExp]> = [
      ["", /Paste/],
      ["I think you should lower it.", /valid JSON/],
      ['{"summary":"x"}', /changes/],
      ['{"changes":[]}', /changes/],
      ['{"changes":["verify"]}', /not an object/],
      ['{"changes":[{"to":0.5}]}', /param/],
      ['{"changes":[{"param":"verify_threshold","to":"high"}]}', /number/],
      ['{"changes":[{"param":"verify_threshold"}]}', /number/],
      ['{"changes":[{"param":"verify_threshold","to":null}]}', /number/],
    ];
    for (const [text, pattern] of bad) {
      assert.throws(() => parseAdvisorReply(text), pattern, `input: ${text}`);
    }
  });
});

describe("errorMessage", () => {
  it("shows just the detail of an API error", () => {
    assert.equal(errorMessage(new Error('{"detail":"Proposal not found."}')), "Proposal not found.");
  });
  it("joins validation messages", () => {
    const body = '{"detail":[{"loc":["body","x"],"msg":"field required"},{"msg":"bad value"}]}';
    assert.equal(errorMessage(new Error(body)), "field required; bad value");
  });
  it("passes plain text through and survives odd input", () => {
    assert.equal(errorMessage(new Error("Failed to fetch")), "Failed to fetch");
    assert.equal(errorMessage("boom"), "boom");
    assert.equal(errorMessage(new Error("")), "Something went wrong.");
  });
});

describe("tradeoffPoints", () => {
  const set = (label: string, bf: number | null, bc: number | null, af: number | null, ac: number | null): ImpactSet => ({
    label,
    replay_fidelity: 1,
    before: headline(bf, bc),
    after: headline(af, ac),
    cost_before: cost,
    cost_after: cost,
  });

  it("turns rates into percentages, before and after, with readable labels", () => {
    const { before, after } = tradeoffPoints([set("tuning", 0.0123, 0.8, 0.045, 0.95)]);
    assert.deepEqual(before, [{ label: "Tuning run", friction: 1.23, caught: 80 }]);
    assert.deepEqual(after, [{ label: "Tuning run", friction: 4.5, caught: 95 }]);
  });

  it("skips sets where a rate is missing instead of plotting zero", () => {
    const { before, after } = tradeoffPoints([
      set("RUN-1", null, 0.5, 0.01, 0.6),
      set("RUN-2", 0.01, 0.5, 0.02, null),
    ]);
    assert.equal(before.length, 1);
    assert.equal(before[0].label, "Other run RUN-2");
    assert.equal(after.length, 1);
    assert.equal(after[0].label, "Other run RUN-1");
  });
});

describe("verdictTone", () => {
  it("is good only when every other run improved", () => {
    assert.equal(verdictTone({ validation_runs: 3, improved_on: 3, note: "" }), "good");
    assert.equal(verdictTone({ validation_runs: 3, improved_on: 2, note: "" }), "warn");
    assert.equal(verdictTone({ validation_runs: 0, improved_on: 0, note: "" }), "warn");
    assert.equal(verdictTone(null), "neutral");
  });
});
