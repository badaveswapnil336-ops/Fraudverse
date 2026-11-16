"""Batch scoring must give the same results as scoring one payment at a time.

Uses the real trained models in ml/models/saved, so it is skipped if they are missing.

Run:  PYTHONPATH=. python -m pytest tests/test_batch_scoring.py -q
"""
import pytest

from backend.app.simulator.campaigns import generate_campaign_batch
from ml.models import predict

pytestmark = pytest.mark.skipif(
    not (predict.XGBOOST_MODEL_PATH.exists() and predict.ISOLATION_MODEL_PATH.exists()),
    reason="trained model files are not present",
)

IGNORED = {"case_id"}            # random id, different on every call


def _sample(n=120, seed=7):
    return generate_campaign_batch(
        total_transactions=n,
        fraud_ratio=0.2,
        attack_family="account_takeover",
        hard_negative_ratio=0.1,
        seed=seed,
    )


def test_batch_equals_one_at_a_time_for_every_field():
    transactions = _sample()
    batch = predict.predict_transactions(transactions)
    single = [predict.predict_transaction(t) for t in transactions]

    assert len(batch) == len(single) == len(transactions)
    for b, s in zip(batch, single):
        assert {k: v for k, v in b.items() if k not in IGNORED} == {
            k: v for k, v in s.items() if k not in IGNORED
        }


def test_batch_keeps_input_order():
    transactions = _sample(60, seed=3)
    out = predict.predict_transactions(transactions)
    assert [r["transaction_id"] for r in out] == [t["transaction_id"] for t in transactions]


def test_empty_batch_returns_empty_list():
    assert predict.predict_transactions([]) == []


def test_batch_rejects_a_transaction_with_missing_fields():
    transactions = _sample(10, seed=1)
    del transactions[4]["amount"]
    with pytest.raises(ValueError):
        predict.predict_transactions(transactions)


def test_case_ids_are_unique_in_a_batch():
    out = predict.predict_transactions(_sample(50, seed=2))
    ids = [r["case_id"] for r in out]
    assert len(set(ids)) == len(ids)
