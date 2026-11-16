# Advanced features: scorecard, advisor and approval loop

All data is synthetic. Every number describes the simulated benchmark, not real fraud.

## The loop

```
launch runs  ->  scorecard  ->  advisor proposes  ->  you review the measured effect
     ^                                                         |
     |                                                  approve / reject
     +---------------  new runs use the approved policy  <-----+
```

1. **Launch runs.** `POST /simulate/launch` with `{"attack_family": "account_takeover", "volume": 1000, "seed": 1}`.
   Do this three or four times with different seeds. Campaign mode is on by default.
2. **Read the scorecard.** `GET /scorecard/{run_id}` (or `GET /scorecard` for the latest run):
   campaigns caught vs missed, time to detect, fraud value let through, and genuine payments
   blocked or challenged per scenario (`normal`, `travel`, `new_payee`, `spending_spike`).
3. **Ask for a proposal.** `POST /advisor/suggest` with `{"run_id": "RUN-...", "validation_runs": 3}`.
   The advisor searches the XGBoost weight and the verify / block thresholds and returns a
   proposal. Nothing is applied yet.
4. **Review it.** A proposal contains:
   - `changes`: each parameter, old and new value, a plain-language reason and what that
     single change is worth on the tuning run
   - `impact`: before and after on the tuning run AND on other runs (the validation runs)
   - `verdict`: whether it also helped on the other runs. With no other runs, it says the
     change may be over-fitted
   - `summary`: includes a caution when the best value sits at the edge of the range searched
5. **Decide.** `POST /advisor/proposals/{id}/approve` (optionally with `approved_params` to
   approve only some changes, and a `note`) or `POST /advisor/proposals/{id}/reject`.
   An approved policy is saved to `backend/data/active_policy.json` and survives restarts.
   A proposal is refused if the active policy changed after it was made.
6. **Check on new runs.** Launch a fresh run. Its scorecard shows the active policy.

Every proposal keeps an audit trail (who proposed what, when it was decided, any note).
`GET /advisor/proposals` lists them. `POST /policy/reset` with `{"confirm": true}` returns to
the shipped defaults and is recorded too.

## Getting advice from claude.ai instead

`GET /advisor/prompt?run_id=RUN-...` returns a prompt with the current policy, the results and
the best alternatives found by the search. Paste it into claude.ai, then send Claude's JSON
reply to `POST /advisor/import`:

```json
{"run_id": "RUN-...", "source": "claude",
 "changes": [{"param": "verify_threshold", "to": 0.6, "why": "..."}]}
```

The suggestion is validated (known parameters, numbers only, thresholds in order) and measured
on the data exactly like the built-in one, so you approve based on measured effect and not on
how convincing the explanation sounds.

## How the before/after works

Each scored payment stores both model outputs. A policy only turns them into a decision, so
the advisor re-decides whole runs under the old and new policy without running the models
again. The comparison is on identical transactions. Each preview reports `replay_fidelity`,
the share of stored decisions the replay reproduces under the old policy (stored scores are
rounded to 4 decimals, so a rare boundary case can differ).

## Assumptions to review

The search minimises expected cost. These are assumptions, shown in every proposal and
changeable in the request (`cost`):

| Setting | Default | Meaning |
|---|---|---|
| `challenge_cost` | 25 | handling cost of challenging one genuine payment |
| `false_decline_loss` | 0.4 | share of a wrongly declined payment's value that is lost |
| `verify_effectiveness` | 0.85 | share of fraud stopped when it is only challenged |
| `max_friction_rate` | 0.05 | guardrail: never propose a policy that challenges or blocks more genuine payments than this |

A proposal needs to beat the current policy by at least 2% (`min_gain`) to be recommended.

## Limits

- The server keeps the active policy in memory; run a single worker, or restart workers after
  an approval.
- Only the XGBoost weight and the verify and block thresholds are searched. The monitor and
  critical thresholds stay as they are (they can still be changed through `/advisor/import`).
- Explanations stored on old transactions are not regenerated when a replay changes a decision.
- See `docs/known-limitations.md` for the simulator limits.
