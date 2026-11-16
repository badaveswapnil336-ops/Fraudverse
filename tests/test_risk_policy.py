"""Checks that the configurable risk policy changes nothing by default.

Run:  PYTHONPATH=. python tests/test_risk_policy.py      (or: pytest tests)
"""
import json
import os
import tempfile

from ml.risk_engine.fuse_scores import calculate_risk, fuse_scores, score_to_decision
from ml.risk_engine.policy import (
    DEFAULT_POLICY_PATH,
    RiskPolicy,
    load_policy,
    reset_policy,
    set_policy,
)


# ---- the original hard-coded logic, kept here only as the reference to compare against
def _legacy_fuse(p, a, w=0.70):
    clamp = lambda v: max(0.0, min(1.0, float(v)))
    return round(clamp(clamp(w) * clamp(p) + (1.0 - clamp(w)) * clamp(a)), 4)


def _legacy_decision(score):
    score = max(0.0, min(1.0, float(score)))
    if score >= 0.90:
        return "CRITICAL", "BLOCK"
    if score >= 0.75:
        return "HIGH", "BLOCK"
    if score >= 0.55:
        return "MEDIUM", "VERIFY"
    if score >= 0.35:
        return "LOW", "MONITOR"
    return "LOW", "ALLOW"


def setup_function(_=None):
    reset_policy()


def test_default_policy_file_matches_code_defaults():
    assert load_policy(DEFAULT_POLICY_PATH) == RiskPolicy()


def test_default_behaviour_identical_to_original_on_a_dense_grid():
    reset_policy()
    steps = [i / 200 for i in range(201)]
    for p in steps:
        for a in steps:
            expected_score = _legacy_fuse(p, a)
            level, decision = _legacy_decision(expected_score)
            got = calculate_risk(p, a)
            assert got["risk_score"] == expected_score
            assert (got["risk_level"], got["decision"]) == (level, decision)
            assert got["action"] == decision


def test_cutoff_boundaries_identical_to_original():
    reset_policy()
    for edge in (0.35, 0.55, 0.75, 0.90):
        for score in (edge - 1e-9, edge, edge + 1e-9):
            assert score_to_decision(score) == _legacy_decision(score)


def test_explicit_weight_argument_still_works():
    assert fuse_scores(0.8, 0.2, supervised_weight=0.5) == _legacy_fuse(0.8, 0.2, 0.5)


def test_runtime_override_changes_decisions_and_reset_restores():
    set_policy(RiskPolicy(verify_threshold=0.45))
    assert calculate_risk(0.5, 0.5)["decision"] == "VERIFY"      # 0.50 >= 0.45
    reset_policy()
    assert calculate_risk(0.5, 0.5)["decision"] == "MONITOR"     # 0.50 < 0.55


def test_weight_override():
    set_policy(RiskPolicy(supervised_weight=0.5))
    assert calculate_risk(1.0, 0.0)["risk_score"] == 0.5


def test_invalid_policies_are_rejected():
    for bad in (
        dict(supervised_weight=1.2),
        dict(monitor_threshold=0.6),           # not below verify
        dict(critical_threshold=1.5),
        dict(block_threshold=0.5, verify_threshold=0.55),
    ):
        try:
            RiskPolicy(**bad)
        except ValueError:
            continue
        raise AssertionError(f"accepted invalid policy {bad}")


def test_unknown_keys_in_policy_file_are_rejected():
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
        json.dump({"supervised_weight": 0.7, "verfy_threshold": 0.5}, handle)   # typo
    try:
        try:
            load_policy(handle.name)
        except ValueError:
            return
        raise AssertionError("typo in policy file was accepted")
    finally:
        os.unlink(handle.name)


if __name__ == "__main__":
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_")]
    for name, fn in tests:
        reset_policy()
        fn()
        print(f"ok  {name}")
    print(f"{len(tests)} passed")
