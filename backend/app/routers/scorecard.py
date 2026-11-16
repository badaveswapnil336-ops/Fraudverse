from pathlib import Path
import sys

from fastapi import APIRouter, HTTPException


PROJECT_ROOT = Path(__file__).resolve().parents[3]

if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.app.db.database import get_run, latest_run, list_transactions
from backend.app.scorecard import build_scorecard
from ml.risk_engine.policy import get_policy


router = APIRouter(
    prefix="/scorecard",
    tags=["scorecard"],
)


def _scorecard_for(run_id: str | None):
    run = get_run(run_id) if run_id else latest_run()

    if run is None:
        raise HTTPException(status_code=404, detail="No simulation run found.")

    transactions = list_transactions(
        run_id=run["run_id"],
        limit=run["total_transactions"],
    )

    try:
        return build_scorecard(
            transactions,
            run=run,
            policy=get_policy().to_dict(),
        )
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.get("")
def latest_scorecard():
    return _scorecard_for(None)


@router.get("/{run_id}")
def run_scorecard(run_id: str):
    return _scorecard_for(run_id)
