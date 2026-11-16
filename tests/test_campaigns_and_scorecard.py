"""Tests for campaign-mode generation and the scorecard.

The Fraudverse models (XGBoost / Isolation Forest) are not needed here. Where a scorer is
required, a simple stand-in is used, so these tests check the plumbing and the arithmetic,
NOT how good the real models are.

Run:  PYTHONPATH=. python tests/test_campaigns_and_scorecard.py      (or: pytest tests)
"""
import random

from backend.app.scorecard import build_scorecard
from backend.app.simulator.campaigns import generate_campaign_batch
from backend.app.simulator.generate_transactions import (
    HARD_NEGATIVE_PROFILES,
    generate_transaction_batch,
)
from backend.app.simulator.inject_fraud import ATTACK_FAMILIES
from ml.risk_engine.fuse_scores import score_to_decision

REQUIRED = [
    "transaction_id", "customer_id", "amount", "customer_avg_amount", "amount_ratio",
    "transaction_hour", "velocity_10m", "velocity_24h", "account_age_days",
    "beneficiary_age_minutes", "device_trust_score", "geo_distance_km", "is_new_device",
    "is_new_beneficiary", "channel", "authentication_method", "authentication_success",
    "label",
]
GENUINE_TAGS = {"normal", *HARD_NEGATIVE_PROFILES}


# ------------------------------------------------------------------ stand-in scorers
def standin_score(tx):
    """A crude hand-written risk score. Not Fraudverse's model."""
    r = (0.30 * min(1, max(0, (tx["amount_ratio"] - 1) / 2.5))
         + 0.15 * tx["is_new_device"] + 0.15 * tx["is_new_beneficiary"]
         + 0.15 * (1 - tx["device_trust_score"])
         + 0.10 * min(1, tx["geo_distance_km"] / 500)
         + 0.15 * min(1, tx["velocity_10m"] / 6))
    level, decision = score_to_decision(r)
    return {"risk_score": round(r, 4), "risk_level": level, "decision": decision}


def scored(txns, scorer):
    return [{**t, "score": scorer(t)} for t in txns]


def oracle(tx):          # knows the truth: flags every fraud payment, nothing else
    return {"risk_score": 1.0, "decision": "BLOCK" if tx["label"] == 1 else "ALLOW"}


def nothing(tx):
    return {"risk_score": 0.0, "decision": "ALLOW"}


def everything(tx):
    return {"risk_score": 1.0, "decision": "BLOCK"}


def batch(seed=7, n=600, ratio=0.15, family="account_takeover", hard=0.15):
    return generate_campaign_batch(total_transactions=n, fraud_ratio=ratio,
                                   attack_family=family, hard_negative_ratio=hard,
                                   customer_count=60, seed=seed)


# ------------------------------------------------------------------ generator
def test_counts_fields_and_ordering():
    txns = batch()
    assert len(txns) == 600
    assert sum(t["label"] == 1 for t in txns) == round(600 * 0.15)
    assert [t["sim_time_sec"] for t in txns] == sorted(t["sim_time_sec"] for t in txns)
    for t in txns:
        assert all(k in t for k in REQUIRED)
        assert isinstance(t["sim_time_sec"], int) and t["sim_time_sec"] >= 0


def test_campaign_sizes_always_add_up_to_the_fraud_count():
    from backend.app.simulator.campaigns import _campaign_sizes
    for seed in range(60):
        rng = random.Random(seed)
        for n_fraud in (1, 2, 3, 7, 9, 10, 11, 25, 100, 179, 180):
            sizes = _campaign_sizes(rng, n_fraud)
            assert sum(sizes) == n_fraud, (seed, n_fraud, sizes)
            assert all(s >= 1 for s in sizes)
            if n_fraud >= 3:
                assert all(s >= 3 for s in sizes), (seed, n_fraud, sizes)


def test_total_and_fraud_counts_are_exact_for_many_seeds():
    for seed in range(25):
        for n, ratio in ((900, 0.2), (250, 0.12), (77, 0.3), (5000, 0.05)):
            txns = generate_campaign_batch(total_transactions=n, fraud_ratio=ratio,
                                           customer_count=40, seed=seed)
            assert len(txns) == n
            assert sum(t["label"] == 1 for t in txns) == round(n * ratio), (seed, n, ratio)


def test_fraud_is_grouped_into_single_customer_single_family_campaigns():
    txns = batch(family=None)
    camps = {}
    for t in txns:
        if t["label"] == 1:
            assert t["campaign_id"] and t["scenario_tag"] in ATTACK_FAMILIES
            assert t["attack_type"] == t["scenario_tag"]
            camps.setdefault(t["campaign_id"], []).append(t)
        else:
            assert t["campaign_id"] is None and t["scenario_tag"] in GENUINE_TAGS
    assert len(camps) >= 2
    for items in camps.values():
        assert len(items) >= 2
        assert len({t["customer_id"] for t in items}) == 1
        assert len({t["scenario_tag"] for t in items}) == 1


def test_hard_negatives_are_tagged_and_change_the_features():
    txns = batch(n=1500, hard=0.3)
    tags = {t["scenario_tag"] for t in txns if t["label"] == 0}
    assert tags == GENUINE_TAGS
    for t in txns:
        if t["scenario_tag"] == "travel":
            assert t["is_new_device"] == 1 and t["geo_distance_km"] >= 80
        if t["scenario_tag"] == "new_payee":
            assert t["is_new_beneficiary"] == 1


def test_no_hard_negatives_when_ratio_is_zero():
    assert {t["scenario_tag"] for t in batch(hard=0.0) if t["label"] == 0} == {"normal"}


def test_seed_reproducible_and_global_random_untouched():
    def shape(txns):
        return [(t["sim_time_sec"], t["campaign_id"], t["scenario_tag"], t["amount"],
                 t["is_new_device"]) for t in txns]
    random.seed(123)
    before = random.getstate()
    a = batch(seed=5)
    assert random.getstate() == before           # global generator restored
    b = batch(seed=5)
    c = batch(seed=6)
    assert shape(a) == shape(b)
    assert shape(a) != shape(c)


def test_unseeded_run_and_edge_sizes_work():
    assert len(generate_campaign_batch(total_transactions=1, fraud_ratio=1.0)) == 1
    assert len(generate_campaign_batch(total_transactions=40, fraud_ratio=0.0)) == 40
    all_fraud = generate_campaign_batch(total_transactions=30, fraud_ratio=1.0, seed=1)
    assert all(t["label"] == 1 for t in all_fraud)


def test_invalid_arguments_rejected():
    for kwargs in (dict(total_transactions=0), dict(fraud_ratio=1.5),
                   dict(attack_family="nope"), dict(customer_count=0)):
        try:
            generate_campaign_batch(**kwargs)
        except ValueError:
            continue
        raise AssertionError(f"accepted {kwargs}")


def test_original_generator_still_works_unchanged():
    txns = generate_transaction_batch(total_transactions=200, fraud_ratio=0.2,
                                      attack_family="account_takeover",
                                      hard_negative_ratio=0.2)
    assert len(txns) == 200 and "campaign_id" not in txns[0]


# ------------------------------------------------------------------ scorecard
def test_oracle_catches_everything_with_no_friction():
    card = build_scorecard(scored(batch(), oracle))
    a, g = card["attacks"], card["genuine"]
    assert a["catch_rate"] == 1.0 and a["campaigns_missed"] == 0
    assert a["median_ttd_sec"] == 0 and a["amount_let_through"] == 0
    assert g["friction_rate"] == 0 and g["customers_impacted"] == 0


def test_flagging_nothing_misses_everything():
    txns = batch()
    card = build_scorecard(scored(txns, nothing))
    a = card["attacks"]
    assert a["catch_rate"] == 0.0 and a["median_ttd_sec"] is None
    assert a["amount_let_through"] == a["amount_total"]
    assert len(card["missed_campaigns"]) == min(10, a["campaigns"])


def test_flagging_everything_blocks_every_genuine_payment():
    card = build_scorecard(scored(batch(), everything))
    assert card["genuine"]["block_rate"] == 1.0
    assert card["attacks"]["catch_rate"] == 1.0
    assert all(s["friction_rate"] == 1.0 for s in card["genuine"]["by_scenario"].values())


def test_time_to_detect_arithmetic_on_a_hand_built_campaign():
    def tx(i, ts, decision, amount):
        return {"transaction_id": f"T{i}", "customer_id": "C1", "label": 1,
                "attack_type": "account_takeover", "campaign_id": "CMP-001",
                "sim_time_sec": ts, "amount": amount,
                "score": {"decision": decision, "risk_score": 0.5}}
    rows = [tx(1, 100, "ALLOW", 50.0), tx(2, 160, "MONITOR", 70.0),
            tx(3, 220, "VERIFY", 900.0), tx(4, 280, "BLOCK", 400.0)]
    c = build_scorecard(rows)["campaigns"][0]
    assert c["caught"] and c["time_to_detect_sec"] == 120      # 220 - 100
    assert c["payments_before_stop"] == 2
    assert c["amount_let_through"] == 120.0                    # ALLOW + MONITOR pass
    card = build_scorecard(rows)
    assert card["attacks"]["payments_stopped"] == 2
    assert card["attacks"]["amount_let_through"] == 120.0


def test_standin_scorer_gives_well_formed_scorecard():
    card = build_scorecard(scored(batch(n=900, ratio=0.2, hard=0.2), standin_score),
                           run={"run_id": "RUN-X"}, policy={"supervised_weight": 0.7})
    a, g = card["attacks"], card["genuine"]
    assert card["run"]["run_id"] == "RUN-X" and card["policy"]["supervised_weight"] == 0.7
    assert a["campaign_data"] and a["campaigns"] >= 2
    assert a["campaigns_caught"] + a["campaigns_missed"] == a["campaigns"]
    for rate in (a["catch_rate"], a["stop_rate"], g["block_rate"], g["challenge_rate"],
                 g["friction_rate"]):
        assert 0.0 <= rate <= 1.0
    assert set(g["by_scenario"]) == GENUINE_TAGS
    assert sum(s["payments"] for s in g["by_scenario"].values()) == g["payments"]
    assert a["payments"] + g["payments"] == 900


def test_unscored_run_is_rejected():
    try:
        build_scorecard(batch())
    except ValueError:
        return
    raise AssertionError("scorecard accepted an unscored run")


def test_run_without_campaign_data_degrades_gracefully():
    old = generate_transaction_batch(total_transactions=200, fraud_ratio=0.2,
                                     attack_family="account_takeover")
    card = build_scorecard(scored(old, standin_score))
    assert card["attacks"]["campaign_data"] is False
    assert card["attacks"]["catch_rate"] is None and card["attacks"]["stop_rate"] is not None
    assert set(card["genuine"]["by_scenario"]) == {"unlabelled"}


if __name__ == "__main__":
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_")]
    for name, fn in tests:
        fn()
        print(f"ok  {name}")
    print(f"{len(tests)} passed")
