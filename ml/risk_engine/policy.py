"""Tunable risk policy for the fusion engine.

The defaults reproduce Fraudverse's original hard-coded behaviour exactly:
70/30 XGBoost / anomaly fusion and decision cut-offs 0.35 / 0.55 / 0.75 / 0.90.

The active policy is loaded from `policy.json` next to this file, or from the file named
by the FRAUDVERSE_POLICY_PATH environment variable. It can be swapped at runtime with
`set_policy()`, which is how an approved advisor change will be applied.
"""
from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, fields, replace
from pathlib import Path

DEFAULT_POLICY_PATH = Path(__file__).with_name("policy.json")


@dataclass(frozen=True)
class RiskPolicy:
    supervised_weight: float = 0.70    # share of the fused score from XGBoost; rest is anomaly
    monitor_threshold: float = 0.35    # score >= this -> MONITOR
    verify_threshold: float = 0.55     # score >= this -> VERIFY
    block_threshold: float = 0.75      # score >= this -> BLOCK (HIGH)
    critical_threshold: float = 0.90   # score >= this -> BLOCK (CRITICAL)

    def __post_init__(self):
        if not 0.0 <= self.supervised_weight <= 1.0:
            raise ValueError("supervised_weight must be between 0 and 1")
        cuts = [self.monitor_threshold, self.verify_threshold,
                self.block_threshold, self.critical_threshold]
        if not all(0.0 <= c <= 1.0 for c in cuts):
            raise ValueError("thresholds must be between 0 and 1")
        if not all(a < b for a, b in zip(cuts, cuts[1:])):
            raise ValueError(
                "thresholds must increase: monitor < verify < block < critical"
            )

    def to_dict(self) -> dict:
        return asdict(self)

    def with_changes(self, **changes) -> "RiskPolicy":
        unknown = set(changes) - {f.name for f in fields(self)}
        if unknown:
            raise ValueError(f"unknown policy parameters: {sorted(unknown)}")
        return replace(self, **changes)


def active_policy_path() -> Path:
    """Where an approved (advisor-changed) policy is saved so it survives restarts."""
    env = os.getenv("FRAUDVERSE_ACTIVE_POLICY_PATH")
    if env:
        return Path(env)
    return Path(__file__).resolve().parents[2] / "backend" / "data" / "active_policy.json"


def load_policy(path: str | os.PathLike | None = None) -> RiskPolicy:
    """Read a policy file. Missing keys fall back to defaults; unknown keys are an error.

    Order of precedence: explicit path, FRAUDVERSE_POLICY_PATH, a saved approved policy
    (active_policy.json), then the shipped policy.json.
    """
    explicit = path or os.getenv("FRAUDVERSE_POLICY_PATH")
    if explicit:
        path = Path(explicit)
    elif active_policy_path().exists():
        path = active_policy_path()
    else:
        path = DEFAULT_POLICY_PATH
    if not path.exists():
        return RiskPolicy()
    with path.open(encoding="utf-8") as handle:
        data = json.load(handle)
    unknown = set(data) - {f.name for f in fields(RiskPolicy)}
    if unknown:
        raise ValueError(f"unknown keys in {path}: {sorted(unknown)}")
    return RiskPolicy(**data)


_active: RiskPolicy | None = None


def get_policy() -> RiskPolicy:
    global _active
    if _active is None:
        _active = load_policy()
    return _active


def set_policy(policy: RiskPolicy) -> RiskPolicy:
    global _active
    _active = policy
    return policy


def reset_policy() -> RiskPolicy:
    """Forget any runtime override and reload from disk."""
    global _active
    _active = None
    return get_policy()


def save_policy(policy: RiskPolicy, path: str | os.PathLike | None = None) -> Path:
    """Write the policy atomically so a crash cannot leave a half-written file."""
    path = Path(path) if path else active_policy_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(policy.to_dict(), indent=2) + "\n", encoding="utf-8")
    os.replace(temp, path)
    return path


def clear_saved_policy() -> None:
    """Delete the saved approved policy so the shipped defaults apply again."""
    active_policy_path().unlink(missing_ok=True)
