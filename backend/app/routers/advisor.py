from pathlib import Path
import sys
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field


PROJECT_ROOT = Path(__file__).resolve().parents[3]

if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.app import advisor
from backend.app.db.database import (
    get_proposal,
    get_run,
    latest_run,
    list_proposals,
    list_runs,
    list_transactions,
    save_proposal,
)
from backend.app.events import publish_event
from backend.app.scorecard import build_scorecard
from ml.risk_engine.policy import (
    RiskPolicy,
    clear_saved_policy,
    get_policy,
    save_policy,
    set_policy,
)
from ml.risk_engine.rescore import rescore


router = APIRouter(tags=["advisor"])


class CostIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    challenge_cost: float = Field(default=25.0, ge=0)
    false_decline_loss: float = Field(default=0.4, ge=0, le=1)
    verify_effectiveness: float = Field(default=0.85, ge=0, le=1)
    max_friction_rate: float = Field(default=0.05, gt=0, le=1)


class SuggestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str | None = None
    validation_runs: int = Field(default=3, ge=0, le=10)
    # Name the runs to validate on instead of taking the most recent ones. Makes a
    # proposal reproducible regardless of what else is in the database.
    validation_run_ids: list[str] | None = None
    min_gain: float = Field(default=0.02, ge=0, le=1)
    cost: CostIn = CostIn()


class ChangeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    param: str
    to: float
    why: str | None = None


class ImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str | None = None
    source: Literal["claude", "manual"] = "claude"
    summary: str | None = None
    changes: list[ChangeIn]
    validation_runs: int = Field(default=3, ge=0, le=10)
    validation_run_ids: list[str] | None = None
    cost: CostIn = CostIn()


class ApproveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    approved_params: list[str] | None = None     # None approves every change
    note: str | None = None


class RejectRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    note: str | None = None


class ResetRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    confirm: bool = False
    note: str | None = None


# ----------------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------------

def _is_usable(transactions):
    return (
        any(t.get("score") for t in transactions)
        and any(t.get("campaign_id") for t in transactions)
    )


def _load(run_id: str | None):
    run = get_run(run_id) if run_id else latest_run()

    if run is None:
        raise HTTPException(status_code=404, detail="No simulation run found.")

    transactions = list_transactions(
        run_id=run["run_id"],
        limit=run["total_transactions"],
    )

    if not _is_usable(transactions):
        raise HTTPException(
            status_code=409,
            detail=(
                "This run cannot be tuned on. Launch it with score_all=true and "
                "campaign_mode=true."
            ),
        )

    return run, transactions


def _validation_sets(exclude_run_id: str, wanted: int, run_ids: list[str] | None = None):
    sets = []

    if run_ids is not None:
        for other_id in dict.fromkeys(run_ids):          # keep order, drop repeats
            if other_id == exclude_run_id:
                continue

            other = get_run(other_id)
            if other is None:
                raise HTTPException(
                    status_code=404, detail=f"Validation run {other_id} not found."
                )

            transactions = list_transactions(
                run_id=other_id, limit=other["total_transactions"]
            )
            if not _is_usable(transactions):
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"Validation run {other_id} cannot be used. It needs "
                        "score_all=true and campaign_mode=true."
                    ),
                )
            sets.append((other_id, transactions))

        return sets

    if wanted <= 0:
        return sets

    for other in list_runs(limit=30):
        if other["run_id"] == exclude_run_id:
            continue

        transactions = list_transactions(
            run_id=other["run_id"],
            limit=other["total_transactions"],
        )

        if _is_usable(transactions):
            sets.append((other["run_id"], transactions))

        if len(sets) >= wanted:
            break

    return sets


def _to_model(cost: CostIn) -> advisor.CostModel:
    return advisor.CostModel(**cost.model_dump())


def _announce(message: str, proposal: dict):
    publish_event(
        "POLICY",
        message,
        run_id=proposal.get("run_id"),
        data={
            "proposal_id": proposal["proposal_id"],
            "status": proposal["status"],
            "source": proposal["source"],
        },
    )


# ----------------------------------------------------------------------------
# active policy
# ----------------------------------------------------------------------------

@router.get("/policy")
def read_policy():
    return {
        "active": get_policy().to_dict(),
        "defaults": RiskPolicy().to_dict(),
        "doc": advisor.POLICY_DOC,
    }


@router.post("/policy/reset")
def reset_to_defaults(payload: ResetRequest):
    if not payload.confirm:
        raise HTTPException(
            status_code=400,
            detail="Send {\"confirm\": true} to reset the policy to the shipped defaults.",
        )

    before = get_policy()
    after = RiskPolicy()
    record = advisor.reset_record(before, after, payload.note)
    set_policy(after)
    clear_saved_policy()
    save_proposal(record)
    _announce("Policy reset to the shipped defaults", record)

    return {"active": after.to_dict(), "record": record}


# ----------------------------------------------------------------------------
# advisor
# ----------------------------------------------------------------------------

@router.post("/advisor/suggest")
def suggest(payload: SuggestRequest):
    run, transactions = _load(payload.run_id)
    model = _to_model(payload.cost)
    proposal = advisor.suggest(
        run["run_id"],
        transactions,
        _validation_sets(run["run_id"], payload.validation_runs, payload.validation_run_ids),
        get_policy(),
        model,
        min_gain=payload.min_gain,
    )
    save_proposal(proposal)
    _announce(f"Advisor proposal {proposal['proposal_id']}: {proposal['summary']}", proposal)

    return proposal


@router.get("/advisor/prompt")
def claude_prompt(run_id: str | None = None):
    """The prompt to paste into claude.ai. Its JSON reply goes to POST /advisor/import."""
    run, transactions = _load(run_id)
    base = get_policy()
    model = advisor.CostModel()
    card = build_scorecard(rescore(transactions, base))
    found = advisor.search(transactions, base, model)

    return {
        "run_id": run["run_id"],
        "prompt": advisor.build_prompt(run["run_id"], base, model, {"search": found}, card),
    }


@router.post("/advisor/import")
def import_suggestions(payload: ImportRequest):
    run, transactions = _load(payload.run_id)

    try:
        proposal = advisor.proposal_from_changes(
            run["run_id"],
            payload.source,
            get_policy(),
            [change.model_dump() for change in payload.changes],
            transactions,
            _validation_sets(run["run_id"], payload.validation_runs, payload.validation_run_ids),
            _to_model(payload.cost),
            summary=payload.summary,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    save_proposal(proposal)
    _announce(f"Imported {payload.source} proposal {proposal['proposal_id']}", proposal)

    return proposal


@router.get("/advisor/proposals")
def proposals(status: str | None = None, limit: int = 50):
    return {"proposals": list_proposals(limit=limit, status=status)}


@router.get("/advisor/proposals/{proposal_id}")
def proposal_detail(proposal_id: str):
    proposal = get_proposal(proposal_id)

    if proposal is None:
        raise HTTPException(status_code=404, detail="Proposal not found.")

    return proposal


@router.post("/advisor/proposals/{proposal_id}/approve")
def approve(proposal_id: str, payload: ApproveRequest):
    proposal = get_proposal(proposal_id)

    if proposal is None:
        raise HTTPException(status_code=404, detail="Proposal not found.")

    active = get_policy()

    try:
        new_policy, updated = advisor.apply_approval(
            proposal, active, payload.approved_params, payload.note
        )
    except advisor.StaleProposalError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    # apply, then record; if recording fails, put the old policy back
    save_policy(new_policy)
    set_policy(new_policy)
    try:
        save_proposal(updated)
    except Exception as error:
        save_policy(active)
        set_policy(active)
        raise HTTPException(
            status_code=500,
            detail="Could not record the approval, so the policy was left unchanged.",
        ) from error

    _announce(f"Policy updated by approved proposal {proposal_id}", updated)

    return {"proposal": updated, "active_policy": new_policy.to_dict()}


@router.post("/advisor/proposals/{proposal_id}/reject")
def reject(proposal_id: str, payload: RejectRequest):
    proposal = get_proposal(proposal_id)

    if proposal is None:
        raise HTTPException(status_code=404, detail="Proposal not found.")

    try:
        updated = advisor.reject(proposal, payload.note)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    save_proposal(updated)
    _announce(f"Proposal {proposal_id} rejected", updated)

    return updated
