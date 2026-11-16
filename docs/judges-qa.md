# Judges' Q&A (one page)

All data is synthetic. Numbers come from real runs on 16 November 2026 with fixed seeds. They
describe the simulated benchmark, not real fraud.

**How realistic are the attacks?**
Six attack families, each matched to a public typology (account takeover, synthetic identity,
card testing, rapid movement through new accounts, AI-assisted fraud, multi-step takeover). The
sources are in `docs/fraud-typologies.md`. They support the *kind* of fraud, not our numbers: the
amounts, rates and gaps are our own assumptions. Fraud arrives as campaigns (bursts on one
customer over time), not as scattered rows, so we can measure time to detect. Known limits:
velocity values are random rather than derived from timing, and each payment is scored alone.

**How do you stop an AI from inventing unrealistic attacks?**
The AI never creates payments. It may only suggest scenario *settings*. Those settings are checked
against a JSON schema (allowed attack families, probabilities between 0 and 1, required fields, no
extras). If the AI is off, missing or returns something invalid, a built-in deterministic scenario
is used instead. The payments are produced by fixed generators with seeds. On this laptop no AI
service is used at all. One gap: the amount and velocity multipliers have a lower bound but no
upper bound in the schema.

**What is innovative?**
The closed loop, not any one model. Attack, then measure both missed fraud *and* genuine customers
bothered, then an advisor tests policy changes on other runs, then a human approves with a note and
an audit trail, then the same seeded payments are replayed to verify. The advisor cannot apply
anything itself. The building blocks (XGBoost, Isolation Forest, thresholds) are standard.

**Do you handle seasonality?**
Yes, as a test, not as a solution. A seasonal month adds weekend, month-end salary and festival-week
behaviour to genuine traffic. It exposed a weakness: on seeded runs the shipped models blocked about
78% of festival-week and 35% of salary-day payments. The fix is retraining on seasonal data, which
we have not done. A test for the target (under 10%) is marked as an expected failure. The seasonal
sizes are assumptions with no verified source.

**Which fraud types are covered?**
Account takeover, AI social engineering, synthetic identity, card testing, velocity burst, and
multi-step takeover. The models were trained before the last three were added, so how well they
catch those is simply what the old models do. Card testing: all 21 to 22 campaigns caught per run.
Velocity burst: the weakest, 15 to 17 of 18 to 19 campaigns caught and only 38 to 49 of 100
payments stopped.

**What about multi-step attacks?**
A chain is account change, new payee, small test payment, large transfer, on one account. The
scorecard counts chains stopped *before* the large transfer: 29, 29 and 30 of 30 in three seeded
runs, mostly at the new-payee step. Caveat: the step order and timing are our assumption, and the
models see each payment on its own, not the sequence.

**Which metrics do you use?**
Payment level (VERIFY or BLOCK counts as flagged), on the three fixed demo runs (1,200 payments,
104 fraud): precision 65.4%, recall 96.2%, F1 0.78, false-positive rate 4.8%. Campaign level:
campaigns caught, time to detect, fraud value let through. Customer level: genuine payments
blocked or challenged, by behaviour (travel, new payee, spending spike, seasonal). Precision is
modest because we deliberately include unusual-but-genuine customers.

**What proves it works?**
Three things, all on synthetic data. Runs are repeatable: the same seeds gave identical numbers
every time. The advisor's prediction matched the new runs exactly (17 of 17 campaigns, same fraud
value let through). And in the demo, the approved policy cut genuine payments bothered from 53 to
39 (4.8% to 3.6%) and hard blocks from 39 to 0 with no fraud lost. There are 90 backend and 34
frontend tests. What it does **not** prove: performance on real payments. The models were trained
on data from the same kind of simulator, so these results are in-distribution.

**How is it maintained?**
Policy changes need human approval, are recorded, and can be reset to the shipped defaults.
Seeded runs act as a regression check. The training scripts are in the repository. Not built yet:
drift monitoring, login and roles, and multiple server workers (the active policy lives in
memory). The saved models were made with a slightly older scikit-learn and warn on load, so they
should be retrained.

**What are you not claiming?**
Real-world accuracy, real loss figures (the advisor's cost model is an assumption), or that these
attack numbers match real fraud rates.
