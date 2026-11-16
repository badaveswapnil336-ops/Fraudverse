// Demo mode: fixed runs and the maths for the before / after comparison.
// Pure functions only, so they can be tested without a browser or a backend.

import type { AttackFamily, Proposal, Scorecard } from "./types";

export interface DemoRunSpec {
  attack_family: AttackFamily;
  seed: number;
}

/** Same specs every time. A seed fixes the generated transactions, so a re-run under a new
 *  policy sees identical payments and only the decisions can differ. */
export const DEMO_RUNS: DemoRunSpec[] = [
  { attack_family: "ai_social_engineering", seed: 101 },
  { attack_family: "ai_social_engineering", seed: 102 },
  { attack_family: "account_takeover", seed: 103 },
];

export const DEMO_VOLUME = 400;

export interface DemoTotals {
  runs: number;
  campaigns: number;
  campaignsCaught: number;
  fraudPayments: number;
  amountLetThrough: number;
  genuinePayments: number;
  genuineBlocked: number;
  genuineChallenged: number;
}

export function summarize(scorecards: Scorecard[]): DemoTotals {
  const totals: DemoTotals = {
    runs: scorecards.length,
    campaigns: 0,
    campaignsCaught: 0,
    fraudPayments: 0,
    amountLetThrough: 0,
    genuinePayments: 0,
    genuineBlocked: 0,
    genuineChallenged: 0,
  };

  for (const card of scorecards) {
    totals.campaigns += card.attacks.campaigns;
    totals.campaignsCaught += card.attacks.campaigns_caught;
    totals.fraudPayments += card.attacks.payments;
    totals.amountLetThrough += card.attacks.amount_let_through;
    totals.genuinePayments += card.genuine.payments;
    totals.genuineBlocked += card.genuine.blocked;
    totals.genuineChallenged += card.genuine.challenged;
  }

  return totals;
}

/** Share of genuine payments that were blocked or challenged. */
export function frictionRate(totals: DemoTotals): number | null {
  return totals.genuinePayments
    ? (totals.genuineBlocked + totals.genuineChallenged) / totals.genuinePayments
    : null;
}

/** True when both sets cover the same payments, so a difference can only come from the policy. */
export function sameTraffic(before: DemoTotals, after: DemoTotals): boolean {
  return (
    before.runs === after.runs &&
    before.campaigns === after.campaigns &&
    before.fraudPayments === after.fraudPayments &&
    before.genuinePayments === after.genuinePayments
  );
}

export interface Predicted {
  campaignsCaught: number;
  amountLetThrough: number;
}

/** What the advisor's replay said the new policy would do on exactly these runs.
 *  Returns null unless the proposal was measured on every demo run. */
export function predictedFromProposal(proposal: Proposal, expectedSets: number): Predicted | null {
  if (proposal.impact.length !== expectedSets) return null;

  return proposal.impact.reduce<Predicted>(
    (sum, set) => ({
      campaignsCaught: sum.campaignsCaught + set.after.campaigns_caught,
      amountLetThrough: sum.amountLetThrough + set.after.amount_let_through,
    }),
    { campaignsCaught: 0, amountLetThrough: 0 },
  );
}
