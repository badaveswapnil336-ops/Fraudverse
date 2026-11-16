"""Seasonality, multi-step attack chains and the card-testing / velocity-burst families.

Most tests here need no trained models: they check what the simulator produces and what the
scorecard does with it. The last group runs the real trained models and is skipped if they
are missing.

Run:  PYTHONPATH=. python -m pytest tests/test_realism.py -q
"""
import pytest
from fastapi import HTTPException

from backend.app.routers import simulate
from backend.app.scorecard import build_scorecard
from backend.app.simulator import campaigns
from backend.app.simulator.campaigns import DAY_SEC, SEASON_DAYS, generate_campaign_batch
from backend.app.simulator.inject_fraud import (
    ALL_ATTACK_FAMILIES,
    ATTACK_FAMILIES,
    CHAIN_STEPS,
    EXTRA_ATTACK_FAMILIES,
)

SEASONAL_TAGS = {"salary_day", "festival_spike", "weekend_leisure"}


def batch(family, n=1500, seed=5, **kw):
    return generate_campaign_batch(
        total_transactions=n, fraud_ratio=kw.pop("fraud_ratio", 0.12),
        attack_family=family, seed=seed, **kw,
    )


def mean(values):
    values = list(values)
    return sum(values) / len(values)


# ----------------------------------------------------------------- families
def test_original_family_list_is_unchanged_and_new_ones_are_separate():
    assert ATTACK_FAMILIES == ["account_takeover", "ai_social_engineering", "synthetic_identity"]
    assert EXTRA_ATTACK_FAMILIES == ["card_testing", "velocity_burst", "multi_step_takeover"]
    assert ALL_ATTACK_FAMILIES == ATTACK_FAMILIES + EXTRA_ATTACK_FAMILIES


def test_unknown_family_is_rejected():
    with pytest.raises(ValueError):
        batch("made_up")


def test_default_run_has_no_seasonal_tags_and_stays_in_a_few_hours():
    txs = batch("account_takeover", hard_negative_ratio=0.1)
    assert not SEASONAL_TAGS & {t["scenario_tag"] for t in txs}
    assert max(t["sim_time_sec"] for t in txs) < DAY_SEC


def test_seeded_runs_repeat_exactly():
    def shape(txs):
        return [(t["sim_time_sec"], t["scenario_tag"], t["amount_ratio"], t.get("chain_step"))
                for t in txs]
    for family in EXTRA_ATTACK_FAMILIES:
        assert shape(batch(family, n=400, seasonality=True)) == shape(batch(family, n=400, seasonality=True))


def test_card_testing_is_many_small_fast_payments():
    fraud = [t for t in batch("card_testing") if t["label"] == 1]
    normal = [t for t in batch("card_testing") if t["label"] == 0]
    assert mean(t["amount_ratio"] for t in fraud) < 0.5 < mean(t["amount_ratio"] for t in normal)
    assert mean(t["velocity_10m"] for t in fraud) > 5 > mean(t["velocity_10m"] for t in normal)
    assert all(t["channel"] == "card" and t["attack_type"] == "card_testing" for t in fraud)


def test_velocity_burst_is_ordinary_amounts_at_high_speed_to_new_payees():
    fraud = [t for t in batch("velocity_burst") if t["label"] == 1]
    assert 0.6 < mean(t["amount_ratio"] for t in fraud) < 2.5
    assert mean(t["velocity_10m"] for t in fraud) > 8
    assert mean(t["is_new_beneficiary"] for t in fraud) > 0.7


# ----------------------------------------------------------------- chains
def chains_of(txs):
    groups = {}
    for t in txs:
        if t["campaign_id"]:
            groups.setdefault(t["campaign_id"], []).append(t)
    return [sorted(g, key=lambda t: t["sim_time_sec"]) for g in groups.values()]


def test_every_chain_has_the_four_steps_in_order_on_one_customer():
    chains = chains_of(batch("multi_step_takeover"))
    assert chains
    for chain in chains:
        assert [t["chain_step"] for t in chain] == [1, 2, 3, 4]
        assert [t["chain_step_name"] for t in chain] == CHAIN_STEPS
        assert len({t["customer_id"] for t in chain}) == 1
        times = [t["sim_time_sec"] for t in chain]
        assert times == sorted(times) and len(set(times)) == 4


def test_chain_steps_look_like_the_story_they_tell():
    chains = chains_of(batch("multi_step_takeover", n=2000))
    step = lambda n: [c[n - 1] for c in chains]            # noqa: E731
    assert mean(t["amount_ratio"] for t in step(1)) < 0.2          # account change: near zero
    assert mean(t["amount_ratio"] for t in step(3)) < 0.5          # small test payment
    assert mean(t["amount_ratio"] for t in step(4)) > 2.0          # the large transfer
    assert all(t["is_new_beneficiary"] == 0 for t in step(1))
    assert all(t["is_new_beneficiary"] == 1 for t in step(2) + step(3) + step(4))
    assert mean(t["beneficiary_age_minutes"] for t in step(2)) < mean(
        t["beneficiary_age_minutes"] for t in step(4)
    )


def test_fraud_comes_in_whole_chains():
    for n, ratio in [(400, 0.12), (1000, 0.05), (50, 0.3)]:
        fraud = [t for t in batch("multi_step_takeover", n=n, fraud_ratio=ratio) if t["label"] == 1]
        assert len(fraud) % 4 == 0 and len(fraud) >= 4


def test_a_chain_needs_room_for_four_payments():
    with pytest.raises(ValueError):
        batch("multi_step_takeover", n=3)


def test_scorecard_says_where_each_chain_was_stopped():
    txs = batch("multi_step_takeover", n=800)

    def scored(stop_steps):
        out = []
        for t in txs:
            stop = t["label"] == 1 and t["chain_step"] in stop_steps
            out.append({**t, "score": {"decision": "BLOCK" if stop else "ALLOW", "risk_score": 0.9 if stop else 0.1}})
        return build_scorecard(out)["attacks"]

    early = scored({2, 3, 4})                       # stopped at step 2, before the transfer
    assert early["chains"] > 0 and early["chains_stopped_before_transfer"] == early["chains"]
    assert early["chain_first_stop_step"]["2"] == early["chains"]

    late = scored({4})                              # only the large transfer is stopped
    assert late["chains_stopped_before_transfer"] == 0
    assert late["chain_first_stop_step"]["4"] == late["chains"]

    never = scored(set())
    assert never["chain_first_stop_step"]["never"] == never["chains"]
    assert never["campaigns_missed"] == never["campaigns"]


def test_non_chain_runs_report_zero_chains():
    txs = batch("card_testing", n=500)
    out = [{**t, "score": {"decision": "ALLOW", "risk_score": 0.1}} for t in txs]
    attacks = build_scorecard(out)["attacks"]
    assert attacks["chains"] == 0 and attacks["chains_stopped_before_transfer"] == 0


# ----------------------------------------------------------------- seasonality
def seasonal(n=4000, seed=9, family="account_takeover"):
    return batch(family, n=n, seed=seed, seasonality=True, hard_negative_ratio=0.05)


def test_seasonal_run_covers_a_month_and_keeps_fraud_inside_it():
    txs = seasonal()
    days = {int(t["sim_time_sec"] // DAY_SEC) for t in txs}
    assert min(days) == 0 and max(days) >= SEASON_DAYS - 3
    fraud = [t for t in txs if t["label"] == 1]
    assert fraud and all(t["campaign_id"] for t in fraud)


def test_seasonal_behaviour_appears_only_on_its_own_days():
    txs = [t for t in seasonal() if t["label"] == 0]
    day = lambda t: int(t["sim_time_sec"] // DAY_SEC)                 # noqa: E731
    by_tag = {tag: [t for t in txs if t["scenario_tag"] == tag] for tag in SEASONAL_TAGS}
    assert all(by_tag.values())                                        # all three occur
    assert all(day(t) in campaigns.FESTIVAL_DAYS for t in by_tag["festival_spike"])
    assert all(day(t) in campaigns.MONTH_END_DAYS for t in by_tag["salary_day"])
    assert all(campaigns.is_weekend(day(t)) for t in by_tag["weekend_leisure"])
    assert all(17 <= t["transaction_hour"] <= 23 for t in by_tag["weekend_leisure"])


def test_busy_days_carry_more_genuine_traffic_than_quiet_ones():
    txs = [t for t in seasonal(n=6000) if t["label"] == 0]
    per_day = {}
    for t in txs:
        per_day[int(t["sim_time_sec"] // DAY_SEC)] = per_day.get(int(t["sim_time_sec"] // DAY_SEC), 0) + 1
    quiet = [d for d in range(SEASON_DAYS) if d not in campaigns.FESTIVAL_DAYS
             and d not in campaigns.MONTH_END_DAYS and not campaigns.is_weekend(d)]
    festival = [per_day[d] for d in campaigns.FESTIVAL_DAYS if not campaigns.is_weekend(d)]
    month_end = [per_day[d] for d in campaigns.MONTH_END_DAYS if not campaigns.is_weekend(d)]
    assert mean(festival) > 1.8 * mean(per_day[d] for d in quiet)
    assert mean(month_end) > 1.4 * mean(per_day[d] for d in quiet)


def test_seasonal_payments_are_bigger_than_normal_but_still_genuine():
    txs = [t for t in seasonal(n=6000) if t["label"] == 0]
    normal = mean(t["amount_ratio"] for t in txs if t["scenario_tag"] == "normal")
    festival = [t for t in txs if t["scenario_tag"] == "festival_spike"]
    assert mean(t["amount_ratio"] for t in festival) > normal + 0.5
    assert all(t["label"] == 0 and t["campaign_id"] is None for t in festival)


def test_fraud_runs_through_the_seasonal_month_too():
    for family in ALL_ATTACK_FAMILIES:
        fraud = [t for t in seasonal(n=800, family=family) if t["label"] == 1]
        assert fraud and {t["attack_type"] for t in fraud} == {family}


# ----------------------------------------------------------------- API surface
def test_launch_request_accepts_the_new_families_and_seasonality():
    for family in EXTRA_ATTACK_FAMILIES:
        request = simulate.LaunchRequest(attack_family=family, seasonality=True)
        assert request.attack_family == family and request.seasonality is True
    assert simulate.LaunchRequest().seasonality is False


def test_seasonality_without_campaign_mode_is_refused():
    with pytest.raises(HTTPException) as error:
        simulate.launch_simulation(simulate.LaunchRequest(seasonality=True, campaign_mode=False))
    assert error.value.status_code == 400


def test_every_family_has_a_valid_fallback_scenario():
    from ml.scenario_generator.generate_scenario import generate_scenario, validate_scenario
    for family in ALL_ATTACK_FAMILIES:
        scenario = generate_scenario(family)
        assert scenario["attack_family"] == family and validate_scenario(scenario)


# ----------------------------------------------------------------- real models
def _models_present():
    from ml.models import predict
    return predict.XGBOOST_MODEL_PATH.exists() and predict.ISOLATION_MODEL_PATH.exists()


needs_models = pytest.mark.skipif(not _models_present(), reason="trained model files are not present")


def _real_scorecard(family, seasonality, seed=1, n=1500):
    from ml.models.predict import predict_transactions
    from ml.scenario_generator.generate_scenario import generate_scenario

    scenario = generate_scenario(family)
    txs = generate_campaign_batch(
        total_transactions=n, fraud_ratio=scenario["fraud_ratio"], attack_family=family,
        evasion_strength=scenario["evasion_strength"], hard_negative_ratio=0.1,
        scenario=scenario, seed=seed, seasonality=seasonality,
    )
    scored = [{**t, "score": r} for t, r in zip(txs, predict_transactions(txs))]
    return build_scorecard(scored)


@needs_models
def test_real_models_run_every_new_family_and_the_scorecard_reports_it():
    for family in EXTRA_ATTACK_FAMILIES:
        attacks = _real_scorecard(family, seasonality=False, n=600)["attacks"]
        assert attacks["campaigns"] > 0 and family in attacks["by_family"]


@needs_models
def test_real_models_scorecard_reports_friction_for_each_seasonal_behaviour():
    by_scenario = _real_scorecard("account_takeover", seasonality=True)["genuine"]["by_scenario"]
    for tag in SEASONAL_TAGS:
        assert by_scenario[tag]["payments"] > 0
        assert 0 <= by_scenario[tag]["friction_rate"] <= 1


@needs_models
@pytest.mark.xfail(
    strict=False,
    reason=(
        "KNOWN WEAKNESS: the shipped models were trained without seasonal behaviour. On a seeded "
        "run they block most festival-week payments and many salary-day payments. This is the "
        "target to reach, and it passes once the models are retrained on seasonal data."
    ),
)
def test_target_seasonal_genuine_friction_stays_under_ten_percent():
    by_scenario = _real_scorecard("account_takeover", seasonality=True)["genuine"]["by_scenario"]
    for tag in ("festival_spike", "salary_day"):
        assert by_scenario[tag]["friction_rate"] < 0.10, (tag, by_scenario[tag])


# ----------------------------------------------------------------- no outbound LLM call by default
def test_placeholder_or_empty_llm_key_means_no_outbound_call(monkeypatch):
    from ml.scenario_generator import llm_scenario_generator as gen

    for value in (None, "", "   ", "your_openrouter_key"):
        assert gen.is_placeholder_key(value)
    assert not gen.is_placeholder_key("sk-or-v1-abc123")

    monkeypatch.setenv("OPENROUTER_API_KEY", "your_openrouter_key")
    monkeypatch.setenv("FRAUDVERSE_LOCAL_FALLBACK", "true")
    with pytest.raises(ValueError):
        gen.get_client()                                  # refuses before creating any client

    scenario = gen.generate_llm_scenario("card_testing")  # falls back locally, no network
    assert scenario["_generation"]["source"] == "local_fallback"
