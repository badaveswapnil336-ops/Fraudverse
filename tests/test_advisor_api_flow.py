"""Walks the whole advisor flow through the real endpoint functions and a real SQLite database.

FastAPI is not installed in every environment. If it is missing, a tiny stand-in is used, so
this tests the handler LOGIC (storage, approval, rollback, errors), not the HTTP wiring.
The Fraudverse models are replaced by the stand-in scorer from test_advisor.py.

Run:  PYTHONPATH=. python tests/test_advisor_api_flow.py      (or: pytest tests)
"""
import os
import sys
import tempfile
import types

_TMP = tempfile.mkdtemp(prefix="fraudverse-api-tests-")
os.environ.setdefault("FRAUDVERSE_ACTIVE_POLICY_PATH", os.path.join(_TMP, "none", "active_policy.json"))
os.environ.setdefault("FRAUDVERSE_DB_PATH", os.path.join(_TMP, "test.sqlite"))

try:
    import fastapi                                                      # noqa: F401
    STUBBED = False
except ImportError:
    STUBBED = True
    stub = types.ModuleType("fastapi")

    class HTTPException(Exception):
        def __init__(self, status_code, detail=None):
            super().__init__(detail)
            self.status_code, self.detail = status_code, detail

    class APIRouter:
        def __init__(self, *args, **kwargs):
            pass

        def _decorator(self, *args, **kwargs):
            return lambda fn: fn

        get = post = _decorator

    stub.APIRouter, stub.HTTPException = APIRouter, HTTPException
    sys.modules["fastapi"] = stub

sys.path.insert(0, os.path.dirname(__file__))
import test_advisor as helpers                                         # noqa: E402
from backend.app.db import database as db                              # noqa: E402
from backend.app.routers import advisor as api                         # noqa: E402
from fastapi import HTTPException                                      # noqa: E402
from ml.risk_engine import policy as pol                               # noqa: E402
from ml.risk_engine.policy import RiskPolicy                           # noqa: E402

SCENARIO = {"scenario_id": "SCN-T", "attack_family": "account_takeover", "attack_round": 1}
_state = {}


def fail_with(status, fn, *args):
    try:
        fn(*args)
    except HTTPException as error:
        assert error.status_code == status, (error.status_code, error.detail)
        return error
    raise AssertionError(f"expected HTTP {status}")


def clean():
    pol.clear_saved_policy()
    pol.reset_policy()


def seed_runs():
    if _state:
        return
    db.init_db()
    for index, name in enumerate(("RUN-A", "RUN-B", "RUN-C", "RUN-D")):
        txns = helpers.run(40 + index, n=1000)
        db.save_run(name, SCENARIO, txns)
        db.save_transactions(name, txns)
    plain = helpers.run(60, n=300)                       # an old-style run: no scores, no campaigns
    plain = [{k: v for k, v in t.items() if k not in ("score", "campaign_id")} for t in plain]
    db.save_run("RUN-OLD", SCENARIO, plain)
    db.save_transactions("RUN-OLD", plain)
    _state["ready"] = True


def setup():
    seed_runs()
    clean()


# ------------------------------------------------------------------ tests
def test_read_policy_shows_defaults_and_docs():
    setup()
    out = api.read_policy()
    assert out["active"] == RiskPolicy().to_dict() == out["defaults"]
    assert "verify_threshold" in out["doc"]


def test_suggest_stores_a_proposal_with_validation_on_other_runs():
    setup()
    p = api.suggest(api.SuggestRequest(run_id="RUN-A", validation_runs=2))
    assert p["status"] == "proposed" and p["run_id"] == "RUN-A" and p["changes"]
    labels = [i["label"] for i in p["impact"]]
    assert labels[0] == "tuning" and len(labels) == 3 and "RUN-A" not in labels[1:]
    assert db.get_proposal(p["proposal_id"]) == p
    assert pol.get_policy() == RiskPolicy()                 # suggesting changes nothing


def test_approve_applies_persists_and_survives_a_restart():
    setup()
    p = api.suggest(api.SuggestRequest(run_id="RUN-A", validation_runs=1))
    out = api.approve(p["proposal_id"], api.ApproveRequest(note="checked on two runs"))
    proposed = RiskPolicy(**p["proposed_policy"])
    assert out["active_policy"] == proposed.to_dict() and out["proposal"]["status"] == "approved"
    assert pol.get_policy() == proposed
    assert pol.active_policy_path().exists()
    assert pol.reset_policy() == proposed                    # simulated restart reads the file
    saved = db.get_proposal(p["proposal_id"])
    assert saved["status"] == "approved" and saved["audit"][0]["note"] == "checked on two runs"
    assert saved["proposal_id"] in [x["proposal_id"] for x in db.list_proposals(status="approved")]
    clean()


def test_second_proposal_made_before_the_first_was_applied_is_refused_as_stale():
    setup()
    first = api.suggest(api.SuggestRequest(run_id="RUN-A", validation_runs=0))
    second = api.suggest(api.SuggestRequest(run_id="RUN-B", validation_runs=0))
    api.approve(first["proposal_id"], api.ApproveRequest())
    err = fail_with(409, api.approve, second["proposal_id"], api.ApproveRequest())
    assert "changed" in err.detail
    assert db.get_proposal(second["proposal_id"])["status"] == "proposed"
    clean()


def test_partial_approval_through_the_api():
    setup()
    p = api.import_suggestions(api.ImportRequest(
        run_id="RUN-A", validation_runs=0, summary="two ideas",
        changes=[api.ChangeIn(param="verify_threshold", to=0.6, why="fewer challenges"),
                 api.ChangeIn(param="supervised_weight", to=0.8)]))
    out = api.approve(p["proposal_id"], api.ApproveRequest(approved_params=["supervised_weight"]))
    active = pol.get_policy()
    assert active.supervised_weight == 0.8 and active.verify_threshold == RiskPolicy().verify_threshold
    assert out["proposal"]["status"] == "partially_approved"
    clean()


def test_reject_leaves_policy_alone_and_cannot_be_decided_twice():
    setup()
    p = api.import_suggestions(api.ImportRequest(
        run_id="RUN-A", validation_runs=0,
        changes=[api.ChangeIn(param="verify_threshold", to=0.6)]))
    out = api.reject(p["proposal_id"], api.RejectRequest(note="no"))
    assert out["status"] == "rejected" and pol.get_policy() == RiskPolicy()
    fail_with(400, api.reject, p["proposal_id"], api.RejectRequest())
    fail_with(400, api.approve, p["proposal_id"], api.ApproveRequest())


def test_bad_imports_and_unknown_things_get_clear_errors():
    setup()
    fail_with(422, api.import_suggestions, api.ImportRequest(
        run_id="RUN-A", changes=[api.ChangeIn(param="made_up", to=1)]))
    fail_with(422, api.import_suggestions, api.ImportRequest(
        run_id="RUN-A", changes=[api.ChangeIn(param="verify_threshold", to=0.95)]))
    fail_with(404, api.proposal_detail, "PROP-NOPE")
    fail_with(404, api.approve, "PROP-NOPE", api.ApproveRequest())
    fail_with(404, api.suggest, api.SuggestRequest(run_id="RUN-MISSING"))
    fail_with(409, api.suggest, api.SuggestRequest(run_id="RUN-OLD"))     # not tunable
    fail_with(400, api.approve, api.import_suggestions(api.ImportRequest(
        run_id="RUN-A", validation_runs=0,
        changes=[api.ChangeIn(param="verify_threshold", to=0.6)]))["proposal_id"],
        api.ApproveRequest(approved_params=["block_threshold"]))


def test_failed_recording_rolls_the_policy_back():
    setup()
    p = api.import_suggestions(api.ImportRequest(
        run_id="RUN-A", validation_runs=0,
        changes=[api.ChangeIn(param="verify_threshold", to=0.6)]))
    original = api.save_proposal

    def broken(_):
        raise RuntimeError("disk full")

    api.save_proposal = broken
    try:
        fail_with(500, api.approve, p["proposal_id"], api.ApproveRequest())
    finally:
        api.save_proposal = original
    assert pol.get_policy() == RiskPolicy()
    assert pol.reset_policy() == RiskPolicy()                # the file was restored too
    assert db.get_proposal(p["proposal_id"])["status"] == "proposed"


def test_claude_prompt_endpoint():
    setup()
    out = api.claude_prompt("RUN-A")
    assert out["run_id"] == "RUN-A"
    for needle in ("Reply with ONLY this JSON", "verify_threshold", "SYNTHETIC"):
        assert needle in out["prompt"]


def test_reset_needs_confirmation_and_is_recorded():
    setup()
    p = api.import_suggestions(api.ImportRequest(
        run_id="RUN-A", validation_runs=0,
        changes=[api.ChangeIn(param="verify_threshold", to=0.6)]))
    api.approve(p["proposal_id"], api.ApproveRequest())
    assert pol.get_policy() != RiskPolicy()
    fail_with(400, api.reset_to_defaults, api.ResetRequest())
    out = api.reset_to_defaults(api.ResetRequest(confirm=True, note="demo over"))
    assert out["active"] == RiskPolicy().to_dict() == pol.reset_policy().to_dict()
    assert not pol.active_policy_path().exists()
    record = db.get_proposal(out["record"]["proposal_id"])
    assert record["status"] == "reset" and record["audit"][0]["note"] == "demo over"
    clean()


def test_named_validation_runs_are_used_exactly_and_in_order():
    setup()
    p = api.suggest(api.SuggestRequest(
        run_id="RUN-A", validation_run_ids=["RUN-C", "RUN-B", "RUN-C", "RUN-A"],
    ))
    labels = [i["label"] for i in p["impact"]]
    assert labels == ["tuning", "RUN-C", "RUN-B"]           # order kept, repeats and the tuning run dropped


def test_named_validation_runs_must_exist_and_be_usable():
    setup()
    fail_with(404, api.suggest, api.SuggestRequest(run_id="RUN-A", validation_run_ids=["RUN-NOPE"]))
    fail_with(409, api.suggest, api.SuggestRequest(run_id="RUN-A", validation_run_ids=["RUN-OLD"]))


def test_empty_named_list_means_no_validation_not_the_default():
    setup()
    p = api.suggest(api.SuggestRequest(run_id="RUN-A", validation_run_ids=[]))
    assert [i["label"] for i in p["impact"]] == ["tuning"]


if __name__ == "__main__":
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_")]
    for name, fn in tests:
        fn()
        print(f"ok  {name}")
    print(f"{len(tests)} passed" + ("   (FastAPI stand-in used)" if STUBBED else ""))
