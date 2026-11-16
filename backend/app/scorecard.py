"""Scorecard for one simulation run: how the defence did against the hidden ground truth.

Pure Python, no web or model dependencies, so it can be tested anywhere.

Definitions (Fraudverse's own: a VERIFY or BLOCK decision opens a case):
  stopped        decision is VERIFY or BLOCK
  campaign caught  any payment of the campaign was stopped
  time to detect   simulated seconds from the campaign's first payment to its first stopped one
  genuine friction genuine payment that was verified (challenged) or blocked
"""
import statistics
from collections import defaultdict

STOP = {"VERIFY", "BLOCK"}


def _decision(tx):
    return (tx.get("score") or {}).get("decision")


def _risk(tx):
    return (tx.get("score") or {}).get("risk_score")


def _rate(a, b):
    return round(a / b, 4) if b else None


def _pct(values, p):
    if not values:
        return None
    v = sorted(values)
    return v[min(len(v) - 1, int(round(p / 100 * (len(v) - 1))))]


def _campaign_stats(fraud):
    groups = defaultdict(list)
    for tx in fraud:
        if tx.get("campaign_id"):
            groups[tx["campaign_id"]].append(tx)

    stats = []
    for campaign_id, items in groups.items():
        items.sort(key=lambda t: t.get("sim_time_sec", 0))
        stop_at = next((i for i, t in enumerate(items) if _decision(t) in STOP), None)
        first_ts = items[0].get("sim_time_sec", 0)
        stats.append({
            "campaign_id": campaign_id,
            "attack_family": items[0].get("attack_type"),
            "customer_id": items[0].get("customer_id"),
            "payments": len(items),
            "amount_total": round(sum(t["amount"] for t in items), 2),
            "amount_let_through": round(
                sum(t["amount"] for t in items if _decision(t) not in STOP), 2),
            "caught": stop_at is not None,
            # multi-step takeovers: which step of the chain was first stopped
            # (1 account_change ... 4 large_transfer), None if the chain went through
            "chain": any(t.get("chain_step") for t in items),
            "stopped_at_step": (items[stop_at].get("chain_step")
                                if stop_at is not None else None),
            "time_to_detect_sec": (items[stop_at].get("sim_time_sec", 0) - first_ts
                                   if stop_at is not None else None),
            "payments_before_stop": stop_at if stop_at is not None else len(items),
            "max_risk_score": max((_risk(t) or 0) for t in items),
        })
    return stats


def build_scorecard(transactions, run=None, policy=None):
    scored = [t for t in transactions if t.get("score")]
    if not scored:
        raise ValueError(
            "This run has no scored transactions. Launch it with score_all=true."
        )

    fraud = [t for t in scored if t["label"] == 1]
    genuine = [t for t in scored if t["label"] == 0]
    campaigns = _campaign_stats(fraud)

    # ---------------- attacks
    fraud_stopped = [t for t in fraud if _decision(t) in STOP]
    ttds = [c["time_to_detect_sec"] for c in campaigns if c["caught"]]
    by_family = {}
    for family in sorted({t.get("attack_type") or "unknown" for t in fraud}):
        f_txns = [t for t in fraud if (t.get("attack_type") or "unknown") == family]
        f_camps = [c for c in campaigns if c["attack_family"] == family]
        f_ttd = [c["time_to_detect_sec"] for c in f_camps if c["caught"]]
        stopped = [t for t in f_txns if _decision(t) in STOP]
        by_family[family] = {
            "campaigns": len(f_camps),
            "campaigns_caught": sum(c["caught"] for c in f_camps),
            "catch_rate": _rate(sum(c["caught"] for c in f_camps), len(f_camps)),
            "payments": len(f_txns),
            "payments_stopped": len(stopped),
            "stop_rate": _rate(len(stopped), len(f_txns)),
            "median_ttd_sec": statistics.median(f_ttd) if f_ttd else None,
            "p90_ttd_sec": _pct(f_ttd, 90),
            "amount_let_through": round(
                sum(t["amount"] for t in f_txns if _decision(t) not in STOP), 2),
        }
    attacks = {
        "campaign_data": bool(campaigns),
        "campaigns": len(campaigns),
        "campaigns_caught": sum(c["caught"] for c in campaigns),
        "campaigns_missed": sum(not c["caught"] for c in campaigns),
        "catch_rate": _rate(sum(c["caught"] for c in campaigns), len(campaigns)),
        "payments": len(fraud),
        "payments_stopped": len(fraud_stopped),
        "stop_rate": _rate(len(fraud_stopped), len(fraud)),
        "amount_total": round(sum(t["amount"] for t in fraud), 2),
        "amount_let_through": round(
            sum(t["amount"] for t in fraud if _decision(t) not in STOP), 2),
        "median_ttd_sec": statistics.median(ttds) if ttds else None,
        "p90_ttd_sec": _pct(ttds, 90),
        "by_family": by_family,
    }

    chains = [c for c in campaigns if c["chain"]]
    attacks["chains"] = len(chains)
    # the point of catching a chain early: stop it before the large transfer (step 4)
    attacks["chains_stopped_before_transfer"] = sum(
        1 for c in chains if c["stopped_at_step"] is not None and c["stopped_at_step"] < 4
    )
    attacks["chain_first_stop_step"] = {
        str(step): sum(1 for c in chains if c["stopped_at_step"] == step) for step in (1, 2, 3, 4)
    }
    attacks["chain_first_stop_step"]["never"] = sum(
        1 for c in chains if c["stopped_at_step"] is None
    )

    # ---------------- genuine customers
    def friction_block(items):
        blocked = [t for t in items if _decision(t) == "BLOCK"]
        challenged = [t for t in items if _decision(t) == "VERIFY"]
        hit = blocked + challenged
        return {
            "payments": len(items),
            "blocked": len(blocked),
            "challenged": len(challenged),
            "block_rate": _rate(len(blocked), len(items)),
            "challenge_rate": _rate(len(challenged), len(items)),
            "friction_rate": _rate(len(hit), len(items)),
            "customers_impacted": len({t.get("customer_id") for t in hit}),
            "amount_blocked": round(sum(t["amount"] for t in blocked), 2),
        }

    by_scenario = {}
    for tag in sorted({t.get("scenario_tag") or "unlabelled" for t in genuine}):
        items = [t for t in genuine if (t.get("scenario_tag") or "unlabelled") == tag]
        by_scenario[tag] = friction_block(items)
    genuine_card = friction_block(genuine)
    genuine_card["by_scenario"] = by_scenario

    # ---------------- examples for the advisor / dashboard
    missed = sorted((c for c in campaigns if not c["caught"]),
                    key=lambda c: -c["amount_total"])[:10]
    false_positives = sorted(
        (t for t in genuine if _decision(t) in STOP),
        key=lambda t: (_decision(t) != "BLOCK", -(_risk(t) or 0)))[:10]

    return {
        "run": run and {k: run.get(k) for k in (
            "run_id", "scenario_id", "attack_family", "attack_round",
            "total_transactions", "fraud_transactions", "created_at")},
        "policy": policy,
        "attacks": attacks,
        "genuine": genuine_card,
        "campaigns": campaigns,
        "missed_campaigns": missed,
        "false_positive_examples": [
            {
                "transaction_id": t["transaction_id"],
                "scenario_tag": t.get("scenario_tag"),
                "amount": t["amount"],
                "decision": _decision(t),
                "risk_score": _risk(t),
                "top_risk_factors": (t.get("score") or {}).get("top_risk_factors"),
            }
            for t in false_positives
        ],
    }
