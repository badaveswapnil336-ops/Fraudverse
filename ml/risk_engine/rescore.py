"""Replay stored model scores under a different risk policy.

Every scored transaction keeps the two model outputs (`xgboost_score`, `anomaly_score`).
The policy only turns those into a fused score and a decision, so a whole run can be
re-decided under a candidate policy without running the models again. That gives an exact
before/after on the same transactions.

Note: the stored model scores are rounded to 4 decimals, so a replay under the policy that
was originally active can differ from the stored decision in a rare boundary case.
`replay_fidelity` measures that.
"""
from __future__ import annotations

from ml.risk_engine.fuse_scores import calculate_risk
from ml.risk_engine.policy import RiskPolicy


def _model_scores(tx: dict) -> tuple[float, float]:
    score = tx.get("score") or {}
    p = score.get("xgboost_score", score.get("fraud_probability"))
    a = score.get("anomaly_score")
    if p is None or a is None:
        raise ValueError(
            f"transaction {tx.get('transaction_id')} has no stored model scores "
            "(xgboost_score / anomaly_score), so it cannot be re-decided"
        )
    return float(p), float(a)


def rescore_transaction(tx: dict, policy: RiskPolicy) -> dict:
    if not tx.get("score"):
        return tx
    p, a = _model_scores(tx)
    result = calculate_risk(p, a, policy=policy)     # risk_score, risk_level, decision, action
    return {**tx, "score": {**tx["score"], **result}}


def rescore(transactions: list[dict], policy: RiskPolicy) -> list[dict]:
    """Copies of the transactions with decisions recomputed under `policy`."""
    return [rescore_transaction(tx, policy) for tx in transactions]


def replay_fidelity(transactions: list[dict], policy: RiskPolicy) -> float | None:
    """Share of scored transactions whose stored decision a replay under `policy` reproduces."""
    scored = [tx for tx in transactions if tx.get("score")]
    if not scored:
        return None
    same = sum(
        rescore_transaction(tx, policy)["score"]["decision"] == tx["score"]["decision"]
        for tx in scored
    )
    return round(same / len(scored), 4)
