"""Tests for re-scoring, the advisor, proposals, approval and persistence.

The real Fraudverse models are not needed: a stand-in two-model scorer writes the same stored
fields (xgboost_score, anomaly_score, decision...) that Fraudverse stores. These tests check the
logic and arithmetic, NOT how good the real models are.

Run:  PYTHONPATH=. python tests/test_advisor.py      (or: pytest tests)
"""
import os
import sqlite3
import tempfile

_TMP = tempfile.mkdtemp(prefix="fraudverse-tests-")
os.environ.setdefault("FRAUDVERSE_ACTIVE_POLICY_PATH", os.path.join(_TMP, "none", "active_policy.json"))
os.environ.setdefault("FRAUDVERSE_DB_PATH", os.path.join(_TMP, "test.sqlite"))

from backend.app import advisor as adv                                  # noqa: E402
from backend.app.db import database as db                              # noqa: E402
from backend.app.scorecard import build_scorecard                       # noqa: E402
from backend.app.simulator.campaigns import generate_campaign_batch     # noqa: E402
from ml.risk_engine import policy as pol                                # noqa: E402
from ml.risk_engine.fuse_scores import calculate_risk                   # noqa: E402
from ml.risk_engine.policy import RiskPolicy                            # noqa: E402
from ml.risk_engine.rescore import replay_fidelity, rescore             # noqa: E402

MODEL = adv.CostModel()


def standin(tx):
    """Two crude stand-in model outputs, stored the way Fraudverse stores them."""
    p = round(min(1.0, 0.30 * min(1, max(0, (tx["amount_ratio"] - 1) / 2.5))
                  + 0.20 * tx["is_new_device"] + 0.20 * tx["is_new_beneficiary"]
                  + 0.10 * (1 - tx["device_trust_score"])
                  + 0.20 * min(1, tx["velocity_10m"] / 6)), 4)
    a = round(min(1.0, 0.5 * min(1, tx["geo_distance_km"] / 500)
                  + 0.5 * (1 - tx["device_trust_score"])), 4)
    return {"xgboost_score": p, "fraud_probability": p, "anomaly_score": a,
            **calculate_risk(p, a, policy=RiskPolicy())}


def run(seed, n=1500):
    txns = generate_campaign_batch(total_transactions=n, fraud_ratio=0.15, customer_count=80,
                                   attack_family="account_takeover", evasion_strength=0.6,
                                   hard_negative_ratio=0.18, seed=seed)
    return [{**t, "score": standin(t)} for t in txns]


def setup_function(_=None):
    pol.reset_policy()


# ------------------------------------------------------------------ re-scoring
def test_replay_under_original_policy_reproduces_stored_decisions():
    assert replay_fidelity(run(1), RiskPolicy()) == 1.0


def test_stricter_verify_threshold_never_challenges_more():
    txns = run(2)
    last = None
    for v in (0.40, 0.50, 0.60, 0.70):
        card = build_scorecard(rescore(txns, RiskPolicy(verify_threshold=v)))
        friction = card["genuine"]["friction_rate"]
        stopped = card["attacks"]["payments_stopped"]
        if last:
            assert friction <= last[0] and stopped <= last[1]
        last = (friction, stopped)


def test_rescore_needs_stored_model_scores():
    tx = {"transaction_id": "T1", "label": 0, "amount": 1.0, "score": {"decision": "ALLOW"}}
    try:
        rescore([tx], RiskPolicy())
    except ValueError:
        return
    raise AssertionError("rescored a transaction with no model scores")


# ------------------------------------------------------------------ cost
def test_cost_arithmetic():
    def tx(label, amount, decision):
        return {"label": label, "amount": amount, "score": {"decision": decision}}
    rows = [tx(1, 100, "ALLOW"), tx(1, 100, "MONITOR"), tx(1, 100, "VERIFY"), tx(1, 100, "BLOCK"),
            tx(0, 500, "BLOCK"), tx(0, 500, "VERIFY"), tx(0, 500, "ALLOW"), tx(0, 500, "MONITOR")]
    c = adv.cost_of(rows, adv.CostModel())
    assert c["fraud_loss"] == 100 + 100 + 100 * 0.15            # allow + monitor + part of verify
    assert c["false_decline_loss"] == 500 * 0.4
    assert c["challenge_cost"] == 25
    assert c["total"] == 215 + 200 + 25
    assert c["friction_rate"] == 0.5


def test_cost_model_validation():
    for bad in (dict(challenge_cost=-1), dict(false_decline_loss=2),
                dict(verify_effectiveness=-0.1), dict(max_friction_rate=0)):
        try:
            adv.CostModel(**bad)
        except ValueError:
            continue
        raise AssertionError(f"accepted {bad}")


# ------------------------------------------------------------------ search
def test_fast_search_matches_the_full_cost_calculation():
    train = run(3)
    found = adv.search(train, RiskPolicy(), MODEL)
    for cand in [found["base"], found["best"]] + found["alternatives"]:
        policy = RiskPolicy(supervised_weight=cand["supervised_weight"],
                            verify_threshold=cand["verify_threshold"],
                            block_threshold=cand["block_threshold"])
        full = adv.cost_of(rescore(train, policy), MODEL)
        assert abs(full["total"] - cand["total_cost"]) < 0.05, (cand, full)
        assert abs(full["friction_rate"] - cand["friction_rate"]) < 1e-4


def test_search_improves_a_badly_tuned_policy_and_respects_the_guardrail():
    train = run(4)
    bad = RiskPolicy(verify_threshold=0.70, block_threshold=0.85)     # lets most fraud through
    found = adv.search(train, bad, MODEL)
    assert found["recommend_change"]
    assert found["best"]["total_cost"] < found["base"]["total_cost"] * 0.98
    assert found["best"]["friction_rate"] <= MODEL.max_friction_rate
    assert all(c["friction_rate"] <= MODEL.max_friction_rate for c in found["alternatives"])


def test_search_recommends_nothing_when_policy_is_already_best():
    train = run(5)
    best = adv.search(train, RiskPolicy(), MODEL)["best"]
    tuned = RiskPolicy(supervised_weight=best["supervised_weight"],
                       verify_threshold=best["verify_threshold"],
                       block_threshold=best["block_threshold"])
    again = adv.search(train, tuned, MODEL)
    assert not again["recommend_change"] and again["best"]["total_cost"] == again["base"]["total_cost"]


def test_guardrail_blocks_a_policy_that_buys_fraud_reduction_with_friction():
    train = run(6)
    strict = adv.CostModel(max_friction_rate=0.0005)                 # almost no friction allowed
    found = adv.search(train, RiskPolicy(), strict)
    assert found["best"]["friction_rate"] <= 0.0005 or not found["recommend_change"]


# ------------------------------------------------------------------ suggestions and previews
def test_suggest_reports_tuning_and_validation_runs():
    train, v1, v2 = run(7), run(8), run(9)
    base = RiskPolicy(verify_threshold=0.70, block_threshold=0.85)
    p = adv.suggest("RUN-T", train, [("RUN-V1", v1), ("RUN-V2", v2)], base, MODEL)
    assert p["status"] == "proposed" and p["source"] == "builtin" and p["audit"] == []
    assert [i["label"] for i in p["impact"]] == ["tuning", "RUN-V1", "RUN-V2"]
    assert p["changes"] and all("why" in c and "from" in c and "to" in c for c in p["changes"])
    assert p["before_policy"] == base.to_dict()
    assert p["verdict"]["validation_runs"] == 2
    for i in p["impact"]:
        assert i["replay_fidelity"] is not None
    # every change must be inside the validated policy space
    RiskPolicy(**p["proposed_policy"])


def test_best_value_on_the_edge_of_the_search_range_is_flagged():
    train = run(30)
    found = adv.search(train, RiskPolicy(), MODEL)
    assert set(found["edge_params"]) <= set(adv.TUNABLE)
    p = adv.suggest("RUN-T", train, [], RiskPolicy(), MODEL)
    if found["edge_params"]:
        assert "edge of the range" in p["summary"] and p["search"]["edge_params"]


def test_reset_record_lists_only_what_changed():
    before = RiskPolicy(supervised_weight=0.6, verify_threshold=0.5)
    rec = adv.reset_record(before, RiskPolicy(), note="demo")
    assert rec["status"] == "reset" and rec["source"] == "reset"
    assert {c["param"] for c in rec["changes"]} == {"supervised_weight", "verify_threshold"}
    assert rec["audit"][0]["note"] == "demo"
    assert rec["applied_policy"] == RiskPolicy().to_dict()


def test_verdict_warns_when_there_is_no_validation_run():
    p = adv.suggest("RUN-T", run(10), [], RiskPolicy(verify_threshold=0.70, block_threshold=0.85), MODEL)
    assert p["verdict"]["validation_runs"] == 0 and "over-fitted" in p["verdict"]["note"]


def test_no_change_recommended_gives_empty_proposal():
    train = run(11)
    best = adv.search(train, RiskPolicy(), MODEL)["best"]
    tuned = RiskPolicy(supervised_weight=best["supervised_weight"],
                       verify_threshold=best["verify_threshold"],
                       block_threshold=best["block_threshold"])
    p = adv.suggest("RUN-T", train, [], tuned, MODEL)
    assert p["changes"] == [] and p["proposed_policy"] == tuned.to_dict()


# ------------------------------------------------------------------ importing outside advice
def test_import_from_claude_validates_and_measures():
    train, val = run(12), run(13)
    raw = [{"param": "verify_threshold", "to": 0.6, "why": "fewer challenges"},
           {"param": "supervised_weight", "to": 0.8}]
    p = adv.proposal_from_changes("RUN-T", "claude", RiskPolicy(), raw, train, [("V", val)], MODEL)
    assert p["source"] == "claude" and {c["param"] for c in p["changes"]} == {"verify_threshold", "supervised_weight"}
    assert any("fewer challenges" in c["why"] for c in p["changes"])
    assert len(p["impact"]) == 2


def test_import_rejects_bad_suggestions():
    train = run(14)
    bad_inputs = [
        [{"param": "made_up", "to": 0.5}],
        [{"param": "verify_threshold", "to": "high"}],
        [{"param": "verify_threshold", "to": True}],
        [{"param": "verify_threshold", "to": 0.95}],                 # above block/critical
        [{"param": "block_threshold", "to": 0.2}],                   # below verify
        [{"param": "supervised_weight", "to": 1.4}],
        [{"param": "verify_threshold", "to": 0.6}, {"param": "verify_threshold", "to": 0.65}],
        [{"param": "verify_threshold", "to": RiskPolicy().verify_threshold}],   # no change
        [],
    ]
    for raw in bad_inputs:
        try:
            adv.proposal_from_changes("R", "claude", RiskPolicy(), raw, train, [], MODEL)
        except ValueError:
            continue
        raise AssertionError(f"accepted {raw}")


def test_prompt_contains_policy_results_and_json_instructions():
    train = run(15)
    sug = adv.suggest("RUN-T", train, [], RiskPolicy(verify_threshold=0.70, block_threshold=0.85), MODEL)
    card = build_scorecard(rescore(train, RiskPolicy(verify_threshold=0.70, block_threshold=0.85)))
    text = adv.build_prompt("RUN-T", RiskPolicy(verify_threshold=0.70, block_threshold=0.85),
                            MODEL, sug, card)
    for needle in ("verify_threshold = 0.7", "SYNTHETIC", "Reply with ONLY this JSON",
                   "account_takeover", "travel", "Cost assumptions"):
        assert needle in text, needle


# ------------------------------------------------------------------ approval
def _proposal():
    train = run(16)
    return adv.suggest("RUN-T", train, [], RiskPolicy(verify_threshold=0.70, block_threshold=0.85), MODEL)


def test_approve_all_applies_every_change_and_is_audited():
    p = _proposal()
    base = RiskPolicy(**p["before_policy"])
    new, updated = adv.apply_approval(p, base, note="looks right")
    assert new == RiskPolicy(**p["proposed_policy"])
    assert updated["status"] == "approved" and updated["audit"][0]["note"] == "looks right"
    assert p["status"] == "proposed"                      # original not mutated


def test_partial_approval_applies_only_chosen_changes():
    p = _proposal()
    if len(p["changes"]) < 2:
        p = adv.proposal_from_changes("R", "claude", RiskPolicy(), [
            {"param": "verify_threshold", "to": 0.6}, {"param": "supervised_weight", "to": 0.8}],
            run(17), [], MODEL)
    base = RiskPolicy(**p["before_policy"])
    first = p["changes"][0]
    new, updated = adv.apply_approval(p, base, approved_params=[first["param"]])
    assert getattr(new, first["param"]) == first["to"]
    for other in p["changes"][1:]:
        assert getattr(new, other["param"]) == getattr(base, other["param"])
    assert updated["status"] == "partially_approved"


def test_approval_refused_when_policy_moved_or_already_decided_or_unknown_param():
    p = _proposal()
    base = RiskPolicy(**p["before_policy"])
    try:
        adv.apply_approval(p, base.with_changes(supervised_weight=0.55))
        raise AssertionError("stale proposal was applied")
    except adv.StaleProposalError:
        pass
    _, done = adv.apply_approval(p, base)
    for call in (lambda: adv.apply_approval(done, base), lambda: adv.reject(done),
                 lambda: adv.apply_approval(p, base, approved_params=["monitor_threshold"]),
                 lambda: adv.apply_approval(p, base, approved_params=[])):
        try:
            call()
        except ValueError:
            continue
        raise AssertionError("invalid approval accepted")


def test_reject_records_decision_and_changes_nothing():
    p = _proposal()
    r = adv.reject(p, note="not now")
    assert r["status"] == "rejected" and r["audit"][0]["action"] == "rejected"
    assert "applied_policy" not in r


# ------------------------------------------------------------------ persistence and storage
def test_approved_policy_survives_a_restart_and_reset_clears_it():
    path = pol.active_policy_path()
    assert not path.exists()
    new = RiskPolicy(supervised_weight=0.6, verify_threshold=0.5)
    pol.set_policy(new)
    pol.save_policy(new)
    assert path.exists()
    assert pol.reset_policy() == new                       # "restart": reload from disk
    pol.clear_saved_policy()
    assert pol.reset_policy() == RiskPolicy()


def test_saved_policy_file_with_typo_is_rejected_not_ignored():
    path = pol.active_policy_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('{"supervised_weight": 0.7, "verfy_threshold": 0.5}')
    try:
        try:
            pol.reset_policy()
        except ValueError:
            return
        raise AssertionError("typo in saved policy was ignored")
    finally:
        pol.clear_saved_policy()
        pol.reset_policy()


def test_proposals_round_trip_through_the_database():
    db.init_db()
    p = _proposal()
    db.save_proposal(p)
    assert db.get_proposal(p["proposal_id"]) == p
    _, updated = adv.apply_approval(p, RiskPolicy(**p["before_policy"]))
    db.save_proposal(updated)
    assert db.get_proposal(p["proposal_id"])["status"] == "approved"
    assert [x["proposal_id"] for x in db.list_proposals()][0] == p["proposal_id"]
    assert db.list_proposals(status="proposed") == []
    assert db.get_proposal("PROP-NOPE") is None
    with sqlite3.connect(db.DB_PATH) as con:
        rows = con.execute("select count(*) from policy_proposals where proposal_id = ?",
                           (p["proposal_id"],)).fetchone()[0]
        assert rows == 1                                  # saved twice, stored once


if __name__ == "__main__":
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_")]
    for name, fn in tests:
        pol.reset_policy()
        fn()
        print(f"ok  {name}")
    print(f"{len(tests)} passed")
