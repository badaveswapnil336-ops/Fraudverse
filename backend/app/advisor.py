"""Advisor: proposes risk-policy changes, shows their measured effect, applies approved ones.

Pure Python (no web or model dependencies), so it can be tested anywhere.

How it works
  1. Every scored payment stores the two model outputs. A policy only turns those into a
     decision, so a run can be re-decided under any candidate policy (ml/risk_engine/rescore).
  2. `search` tries many candidate policies on a run and picks the one with the lowest
     expected cost, as long as it does not bother more than `max_friction_rate` of genuine
     customers. Its changes are small and explained, and each shows what it is worth.
  3. `preview` re-decides the training run AND other runs ("validation") under the old and
     new policy and reports both, so a change that only helps one lucky run is visible.
  4. Suggestions can also come from claude.ai: `build_prompt` writes the prompt and
     `proposal_from_changes` validates the pasted answer and measures it the same way.
  5. Nothing is applied until `apply_approval` is called with a human decision. A change is
     refused if the active policy has moved since the proposal was made.

The cost model is an ASSUMPTION, shown in every proposal. Change it to match the business.
"""
from __future__ import annotations

import uuid
from dataclasses import asdict, dataclass, fields
from datetime import datetime, timezone

from backend.app.scorecard import build_scorecard
from ml.risk_engine.fuse_scores import fuse_scores
from ml.risk_engine.policy import RiskPolicy
from ml.risk_engine.rescore import replay_fidelity, rescore

PASS = {"ALLOW", "MONITOR"}
TUNABLE = ("supervised_weight", "verify_threshold", "block_threshold")
POLICY_FIELDS = tuple(f.name for f in fields(RiskPolicy))

POLICY_DOC = {
    "supervised_weight": "share of the fused score from XGBoost (known fraud patterns); "
                         "the rest comes from the Isolation Forest anomaly score",
    "monitor_threshold": "fused score at or above this -> MONITOR (payment passes, watched)",
    "verify_threshold": "fused score at or above this -> VERIFY (customer is challenged)",
    "block_threshold": "fused score at or above this -> BLOCK (payment declined)",
    "critical_threshold": "fused score at or above this -> BLOCK, flagged CRITICAL",
}

WEIGHTS = (0.5, 0.6, 0.7, 0.8, 0.9)
VERIFY_GRID = tuple(round(0.40 + 0.05 * i, 2) for i in range(7))    # 0.40 .. 0.70
BLOCK_GRID = tuple(round(0.60 + 0.05 * i, 2) for i in range(6))     # 0.60 .. 0.85


class StaleProposalError(Exception):
    """The active policy changed after this proposal was made."""


@dataclass(frozen=True)
class CostModel:
    challenge_cost: float = 25.0          # handling cost of challenging one genuine payment
    false_decline_loss: float = 0.4       # share of a wrongly declined payment's value lost
    verify_effectiveness: float = 0.85    # share of fraud stopped when only challenged
    max_friction_rate: float = 0.05       # guardrail: genuine payments blocked or challenged

    def __post_init__(self):
        if self.challenge_cost < 0:
            raise ValueError("challenge_cost must be >= 0")
        for name in ("false_decline_loss", "verify_effectiveness"):
            if not 0 <= getattr(self, name) <= 1:
                raise ValueError(f"{name} must be between 0 and 1")
        if not 0 < self.max_friction_rate <= 1:
            raise ValueError("max_friction_rate must be in (0, 1]")

    def to_dict(self):
        return asdict(self)


# --------------------------------------------------------------------- cost and headline
def cost_of(transactions: list[dict], model: CostModel) -> dict:
    """Expected cost of the decisions stored on these transactions."""
    fraud_loss = decline_loss = challenge = 0.0
    genuine = friction = 0
    for tx in transactions:
        score = tx.get("score")
        if not score:
            continue
        decision = score["decision"]
        if tx["label"] == 1:
            if decision in PASS:
                fraud_loss += tx["amount"]
            elif decision == "VERIFY":
                fraud_loss += tx["amount"] * (1 - model.verify_effectiveness)
        else:
            genuine += 1
            if decision == "BLOCK":
                decline_loss += tx["amount"] * model.false_decline_loss
                friction += 1
            elif decision == "VERIFY":
                challenge += model.challenge_cost
                friction += 1
    return {
        "total": round(fraud_loss + decline_loss + challenge, 2),
        "fraud_loss": round(fraud_loss, 2),
        "false_decline_loss": round(decline_loss, 2),
        "challenge_cost": round(challenge, 2),
        "friction_rate": round(friction / genuine, 4) if genuine else 0.0,
    }


def headline(card: dict) -> dict:
    a, g = card["attacks"], card["genuine"]
    return {
        "campaigns": a["campaigns"],
        "campaigns_caught": a["campaigns_caught"],
        "campaign_catch_rate": a["catch_rate"],
        "payment_stop_rate": a["stop_rate"],
        "median_ttd_sec": a["median_ttd_sec"],
        "amount_let_through": a["amount_let_through"],
        "genuine_block_rate": g["block_rate"],
        "genuine_challenge_rate": g["challenge_rate"],
        "genuine_friction_rate": g["friction_rate"],
        "friction_by_scenario": {k: v["friction_rate"] for k, v in g["by_scenario"].items()},
    }


# --------------------------------------------------------------------- search
def _prepare(transactions):
    rows = []
    for tx in transactions:
        s = tx.get("score")
        if not s:
            continue
        p = s.get("xgboost_score", s.get("fraud_probability"))
        a = s.get("anomaly_score")
        if p is None or a is None:
            raise ValueError("transactions lack stored model scores; cannot search")
        rows.append((float(p), float(a), tx["label"], float(tx["amount"])))
    if not rows:
        raise ValueError("no scored transactions to tune on")
    return rows


def _eval_fast(fused, rows, verify, block, model):
    fraud_loss = decline = challenge = 0.0
    genuine = friction = 0
    miss = 1 - model.verify_effectiveness
    for score, (_, _, label, amount) in zip(fused, rows):
        if label == 1:
            if score >= block:
                continue
            fraud_loss += amount * miss if score >= verify else amount
        else:
            genuine += 1
            if score >= block:
                decline += amount * model.false_decline_loss
                friction += 1
            elif score >= verify:
                challenge += model.challenge_cost
                friction += 1
    return (fraud_loss + decline + challenge,
            friction / genuine if genuine else 0.0)


def search(transactions: list[dict], base: RiskPolicy, model: CostModel,
           min_gain: float = 0.02, top: int = 5) -> dict:
    """Try candidate policies on these transactions; return the best that respects the guardrail.

    Only the XGBoost weight and the verify / block thresholds are searched. The monitor and
    critical thresholds stay as they are.
    """
    rows = _prepare(transactions)
    weights = sorted(set(WEIGHTS) | {base.supervised_weight})
    verifies = sorted(set(VERIFY_GRID) | {base.verify_threshold})
    blocks = sorted(set(BLOCK_GRID) | {base.block_threshold})

    candidates = []
    for w in weights:
        fused = [fuse_scores(p, a, w) for p, a, _, _ in rows]
        for v in verifies:
            for b in blocks:
                if not base.monitor_threshold < v < b < base.critical_threshold:
                    continue
                total, friction = _eval_fast(fused, rows, v, b, model)
                candidates.append({
                    "supervised_weight": w, "verify_threshold": v, "block_threshold": b,
                    "total_cost": round(total, 2), "friction_rate": round(friction, 4),
                })

    def is_base(c):
        return all(c[k] == getattr(base, k) for k in TUNABLE)

    def distance(c):                 # prefer the smallest change when costs tie
        return sum(c[k] != getattr(base, k) for k in TUNABLE)

    base_c = next(c for c in candidates if is_base(c))
    eligible = [c for c in candidates
                if c["friction_rate"] <= model.max_friction_rate or is_base(c)]
    ranked = sorted(eligible, key=lambda c: (c["total_cost"], c["friction_rate"], distance(c)))
    best = ranked[0]
    recommend = (not is_base(best)) and best["total_cost"] < base_c["total_cost"] * (1 - min_gain)
    chosen = best if recommend else base_c
    grids = {"supervised_weight": WEIGHTS, "verify_threshold": VERIFY_GRID,
             "block_threshold": BLOCK_GRID}
    # a best value on the edge of the searched range means the true optimum may lie beyond it
    edge_params = [k for k, grid in grids.items()
                   if recommend and chosen[k] != getattr(base, k)
                   and chosen[k] in (min(grid), max(grid))]
    return {
        "evaluated": len(candidates),
        "base": base_c,
        "best": chosen,
        "recommend_change": recommend,
        "alternatives": [c for c in ranked if not is_base(c)][:top],
        "edge_params": edge_params,
        "min_gain": min_gain,
    }


# --------------------------------------------------------------------- explaining a change
def _words(param, old, new):
    more = new > old
    if param == "supervised_weight":
        return ("relies more on the known-fraud model and less on the anomaly model" if more
                else "relies more on the anomaly model and less on the known-fraud model")
    if param == "verify_threshold":
        return "challenges fewer payments" if more else "challenges more payments"
    if param == "block_threshold":
        return "declines fewer payments" if more else "declines more payments"
    if param == "monitor_threshold":
        return "watches fewer payments" if more else "watches more payments"
    return "makes the 'critical' band " + ("harder" if more else "easier") + " to reach"


def describe_changes(base: RiskPolicy, proposed: RiskPolicy, train: list[dict],
                     model: CostModel, given_reasons: dict | None = None) -> list[dict]:
    """One entry per changed parameter, with what that single change is worth on `train`."""
    given_reasons = given_reasons or {}
    proposed_cost = cost_of(rescore(train, proposed), model)["total"] if train else None
    out = []
    for param in POLICY_FIELDS:
        old, new = getattr(base, param), getattr(proposed, param)
        if old == new:
            continue
        reason = given_reasons.get(param) or f"{_words(param, old, new)}"
        worth = None
        if train:
            try:
                reverted = proposed.with_changes(**{param: old})
            except ValueError:       # undoing just this one would break the threshold order
                reason += ". It only works together with the other changes"
            else:
                worth = round(
                    cost_of(rescore(train, reverted), model)["total"] - proposed_cost, 2)
                reason += (f". On the tuning run, keeping the old value would cost "
                           f"{worth:+,.0f} compared with this change")
        out.append({"param": param, "from": old, "to": new, "why": reason,
                    "worth_on_tuning_run": worth})
    return out


# --------------------------------------------------------------------- before / after
def preview(base: RiskPolicy, proposed: RiskPolicy, sets: list[tuple[str, list[dict]]],
            model: CostModel) -> list[dict]:
    """Before/after on each (label, transactions) set, re-decided from stored model scores."""
    out = []
    for label, txs in sets:
        before, after = rescore(txs, base), rescore(txs, proposed)
        out.append({
            "label": label,
            "replay_fidelity": replay_fidelity(txs, base),
            "before": headline(build_scorecard(before)),
            "after": headline(build_scorecard(after)),
            "cost_before": cost_of(before, model),
            "cost_after": cost_of(after, model),
        })
    return out


def verdict(impact: list[dict], model: CostModel) -> dict:
    """Does the change hold up beyond the run it was tuned on?"""
    validation = [i for i in impact if i["label"] != "tuning"]
    better = [i for i in validation
              if i["cost_after"]["total"] < i["cost_before"]["total"]
              and i["cost_after"]["friction_rate"] <= model.max_friction_rate]
    if not validation:
        note = ("No other runs were available to check this on. The change was tuned and "
                "measured on the same run, so it may be over-fitted. Launch two or three "
                "more runs and ask again before approving.")
    elif len(better) == len(validation):
        note = f"Improves expected cost on all {len(validation)} other run(s)."
    else:
        note = (f"Improves expected cost on only {len(better)} of {len(validation)} other "
                "run(s). Treat with caution.")
    return {"validation_runs": len(validation), "improved_on": len(better), "note": note}


# --------------------------------------------------------------------- proposals
def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _new_id():
    return f"PROP-{uuid.uuid4().hex[:8].upper()}"


def _proposal(run_id, source, base, proposed, changes, impact, model, summary, extra=None):
    return {
        "proposal_id": _new_id(), "run_id": run_id, "source": source, "status": "proposed",
        "created_at": _now(), "summary": summary,
        "before_policy": base.to_dict(), "proposed_policy": proposed.to_dict(),
        "changes": changes, "impact": impact, "verdict": verdict(impact, model),
        "cost_model": model.to_dict(), "audit": [], **(extra or {}),
    }


def suggest(run_id: str, train: list[dict], validation: list[tuple[str, list[dict]]],
            base: RiskPolicy, model: CostModel, min_gain: float = 0.02) -> dict:
    found = search(train, base, model, min_gain=min_gain)
    if found["recommend_change"]:
        best = found["best"]
        proposed = base.with_changes(**{k: best[k] for k in TUNABLE})
        summary = (f"Searched {found['evaluated']} policies on this run. The best one lowers "
                   f"expected cost from {found['base']['total_cost']:,.0f} to "
                   f"{best['total_cost']:,.0f} while challenging or blocking "
                   f"{best['friction_rate']:.1%} of genuine payments "
                   f"(limit {model.max_friction_rate:.0%}).")
        if found["edge_params"]:
            summary += (f" Caution: the best value of {', '.join(found['edge_params'])} sits at "
                        "the edge of the range searched, so the true optimum may lie beyond it "
                        "and the result deserves a careful look before approval.")
    else:
        proposed = base
        summary = (f"Searched {found['evaluated']} policies. None beats the current policy by "
                   f"at least {min_gain:.0%} within the {model.max_friction_rate:.0%} friction "
                   "limit, so no change is recommended.")
    changes = describe_changes(base, proposed, train, model)
    impact = preview(base, proposed, [("tuning", train)] + list(validation), model)
    return _proposal(run_id, "builtin", base, proposed, changes, impact, model, summary,
                     {"search": {"evaluated": found["evaluated"],
                                 "alternatives": found["alternatives"],
                                 "edge_params": found["edge_params"]}})


def proposal_from_changes(run_id: str, source: str, base: RiskPolicy, raw_changes: list[dict],
                          train: list[dict], validation: list[tuple[str, list[dict]]],
                          model: CostModel, summary: str | None = None) -> dict:
    """Validate suggestions from elsewhere (for example claude.ai) and measure them."""
    wanted, reasons = {}, {}
    for item in raw_changes:
        param, to = item.get("param"), item.get("to")
        if param not in POLICY_FIELDS:
            raise ValueError(f"unknown parameter {param!r}; allowed: {list(POLICY_FIELDS)}")
        if isinstance(to, bool) or not isinstance(to, (int, float)):
            raise ValueError(f"{param}: 'to' must be a number, got {to!r}")
        if param in wanted:
            raise ValueError(f"{param} appears more than once")
        wanted[param] = float(to)
        if item.get("why"):
            reasons[param] = str(item["why"])
    if not wanted:
        raise ValueError("no changes were given")
    proposed = base.with_changes(**wanted)         # RiskPolicy validates ranges and ordering
    changes = describe_changes(base, proposed, train, model, reasons)
    if not changes:
        raise ValueError("the suggested values equal the current policy")
    impact = preview(base, proposed, [("tuning", train)] + list(validation), model)
    return _proposal(run_id, source, base, proposed, changes, impact, model,
                     summary or "Suggested outside Fraudverse and measured here before approval.")


def apply_approval(proposal: dict, active: RiskPolicy, approved_params: list[str] | None = None,
                   note: str | None = None) -> tuple[RiskPolicy, dict]:
    """Apply a human decision. Returns (new policy, updated proposal). Raises on stale/invalid."""
    if proposal["status"] != "proposed":
        raise ValueError(f"proposal is already {proposal['status']}")
    if active != RiskPolicy(**proposal["before_policy"]):
        raise StaleProposalError(
            "The active policy changed after this proposal was made. Ask for a new proposal."
        )
    all_params = [c["param"] for c in proposal["changes"]]
    approved = list(all_params) if approved_params is None else list(approved_params)
    unknown = set(approved) - set(all_params)
    if unknown:
        raise ValueError(f"not part of this proposal: {sorted(unknown)}")
    if not approved:
        raise ValueError("approve at least one change, or reject the proposal")
    new = active.with_changes(**{c["param"]: c["to"] for c in proposal["changes"]
                                 if c["param"] in approved})
    updated = {**proposal,
               "status": "approved" if set(approved) == set(all_params) else "partially_approved",
               "applied_policy": new.to_dict(),
               "audit": proposal["audit"] + [{"at": _now(), "action": "approved",
                                              "approved_params": approved, "note": note}]}
    return new, updated


def reset_record(before: RiskPolicy, after: RiskPolicy, note: str | None = None) -> dict:
    """An audit entry for putting the policy back to the shipped defaults."""
    changes = [{"param": p, "from": getattr(before, p), "to": getattr(after, p),
                "why": "reset to shipped defaults", "worth_on_tuning_run": None}
               for p in POLICY_FIELDS if getattr(before, p) != getattr(after, p)]
    return {
        "proposal_id": _new_id(), "run_id": "-", "source": "reset", "status": "reset",
        "created_at": _now(), "summary": "Policy reset to the shipped defaults.",
        "before_policy": before.to_dict(), "proposed_policy": after.to_dict(),
        "applied_policy": after.to_dict(), "changes": changes, "impact": [],
        "verdict": None, "cost_model": None,
        "audit": [{"at": _now(), "action": "reset", "note": note}],
    }


def reject(proposal: dict, note: str | None = None) -> dict:
    if proposal["status"] != "proposed":
        raise ValueError(f"proposal is already {proposal['status']}")
    return {**proposal, "status": "rejected",
            "audit": proposal["audit"] + [{"at": _now(), "action": "rejected", "note": note}]}


# --------------------------------------------------------------------- claude.ai prompt
def _fmt(x, pct=False):
    if x is None:
        return "n/a"
    return f"{x:.1%}" if pct else f"{x:,.0f}"


def build_prompt(run_id: str, base: RiskPolicy, model: CostModel, suggestion: dict | None,
                 card: dict) -> str:
    a, g = card["attacks"], card["genuine"]
    policy_lines = "\n".join(
        f"- {k} = {getattr(base, k)}: {POLICY_DOC[k]}" for k in POLICY_FIELDS)
    scenario_lines = "\n".join(
        f"- {k}: {_fmt(v['friction_rate'], True)} of {v['payments']} payments challenged or blocked"
        for k, v in g["by_scenario"].items())
    family_lines = "\n".join(
        f"- {k}: {s['campaigns_caught']}/{s['campaigns']} campaigns caught, "
        f"median time to detect {s['median_ttd_sec']}s, value let through "
        f"{_fmt(s['amount_let_through'])}"
        for k, s in a["by_family"].items())
    alt_lines = "(none computed)"
    if suggestion and suggestion.get("search", {}).get("alternatives"):
        alt_lines = "\n".join(
            f"- weight {c['supervised_weight']}, verify {c['verify_threshold']}, "
            f"block {c['block_threshold']}: expected cost {c['total_cost']:,.0f}, "
            f"genuine friction {c['friction_rate']:.1%}"
            for c in suggestion["search"]["alternatives"])
    return f"""You are advising on a payment-fraud decision policy. The data below comes from a
SYNTHETIC simulation (no real customers). Two models score each payment: XGBoost (known fraud
patterns) and an Isolation Forest (anomaly). The policy blends them and turns the blended score
into ALLOW / MONITOR / VERIFY (challenge the customer) / BLOCK (decline).

## Current policy (run {run_id})
{policy_lines}

## Results under the current policy
- Attack campaigns caught: {a['campaigns_caught']}/{a['campaigns']} ({_fmt(a['catch_rate'], True)})
- Median time to detect: {a['median_ttd_sec']} simulated seconds
- Fraud value let through: {_fmt(a['amount_let_through'])} of {_fmt(a['amount_total'])}
- Genuine payments blocked: {_fmt(g['block_rate'], True)}, challenged: {_fmt(g['challenge_rate'], True)}

By attack family:
{family_lines}

Genuine customers who behave unusually:
{scenario_lines}

## Cost assumptions (change them if wrong)
- Challenging a genuine payment costs {model.challenge_cost:,.0f}
- Wrongly declining a genuine payment loses {model.false_decline_loss:.0%} of its value
- A challenge stops {model.verify_effectiveness:.0%} of fraud
- Do not challenge or block more than {model.max_friction_rate:.0%} of genuine payments

## Best alternatives found by an automatic search (for reference)
{alt_lines}

## What I need back
Suggest changes to the policy, and say what each one trades off. Reply with ONLY this JSON:
{{"summary": "one or two sentences",
  "changes": [{{"param": "<name from the policy list>", "to": <number>, "why": "<reason and trade-off>"}}]}}

Rules: use only the parameter names listed above; thresholds must increase
(monitor < verify < block < critical) and all values must be between 0 and 1. A human will
review each change, and it will be measured on the data before anything is applied.
"""
