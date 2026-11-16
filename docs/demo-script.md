# Demo script (about 3 minutes)

All data is synthetic. Every number below came from a real run on 16 November 2026 with the
fixed Demo mode seeds (101, 102, 103), 400 payments per run. The same numbers came out on every
repeat. They hold only if the scenarios come from the built-in fallback, which is the default
(no LLM key is set, so no outside service is contacted).

## Before you present (2 minutes, do it once)

1. Start the backend and the frontend (commands are in the README, "Local Setup").
2. Open http://127.0.0.1:3000. The page should show no yellow warning banner.
3. **Warm up the models.** The first scored run is a few seconds slower because the models load.
   In the Attack Lab launch one small run (volume 100), then go back to Overview.
4. Click **Demo mode**, then **Start demo**, and let it finish once. Then click **Reset demo**.
   This puts the risk policy back to the shipped defaults. Do this before every presentation.
5. Zoom the browser so the comparison table is readable from the back of the room.

If the numbers on screen differ from the ones below, do not quote these numbers. Quote what the
screen shows. They differ if the seeds, the models or the scenarios were changed.

## The script

| Time | You click | You say |
|---|---|---|
| 0:00 | Overview page. | "Fraudverse attacks its own fraud defences. It simulates attackers, measures what gets through **and** how many genuine customers get bothered, then proposes a safer policy that a human approves. All the data is synthetic." |
| 0:20 | **Demo mode** (hero button), then **Start demo**. | "This runs three fixed-seed attack runs under the shipped policy. Fixed seeds mean the payments are identical every time, so any difference we see later comes from the policy alone." |
| 0:35 | Baseline appears (a few seconds). | "Baseline: **17 of 17 attack campaigns caught**. But the policy bothered **53 of 1,096 genuine payments, 4.8%**, and hard-blocked 39 of them. About Rs 67,667 of fraud value still got through." |
| 0:55 | **Step 2: ask the advisor**. | "The advisor tries 180 policy settings on the first run and checks the result on the other two. It changes nothing by itself." |
| 1:15 | Point at the changes table and the caution line. | "It proposes raising the verify threshold from 0.55 to 0.70 and the block threshold from 0.75 to 0.85. It also warns that its best values sit at the edge of the range it searched, so a human should look carefully. Its cost model is an assumption, shown here, not measured data." |
| 1:35 | **Approve all changes**. | "I approve. The change is saved with an audit trail and can be rolled back." |
| 1:45 | The after-run finishes (a few seconds). The before/after table appears. | "Same payments, new policy, measured again." |
| 1:55 | Point at the table, row by row. | "Campaigns caught: still 17 of 17. Fraud value let through: unchanged. Genuine payments **hard-blocked: 39 down to 0**. Genuine payments bothered: **53 down to 39, 4.8% to 3.6%**. The right-hand column is what the advisor predicted before I approved, for the two things it predicts: campaigns caught and fraud value let through. Both matched the new runs." |
| 2:15 | Say this plainly. | "Honest reading: we did not catch more fraud. We removed hard blocks on genuine customers and cut the total bothered by 14, with no fraud lost on these runs. 39 genuine payments are now challenged instead of blocked." |
| 2:25 | **Attack Lab** in the sidebar. Pick **Multi-step Takeover**, tick **Seasonal month**, set Volume to **1500**, **Launch Attack**. | "Beyond the demo: six attack families, including a four-step takeover (account change, new payee, small test payment, large transfer) and a seasonal month with salary days and a festival week." |
| 2:40 | **Reports** in the sidebar. | "The scorecard shows how many chains were stopped before the large transfer, and how each kind of genuine behaviour was treated. Look at the festival-week and salary-day rows in the genuine-customer table. In my test runs the shipped models blocked about 78% of festival-week payments and 35% of salary-day payments, so expect high numbers there. That is a real weakness the system found in itself. Retraining on seasonal data is the next step." |
| 2:55 | Back to Overview. | "Attack, measure, propose, approve, verify. A human stays in control." |

Keep to the time by skipping the Attack Lab part if you are at 2:30. The core story is the
first 2:25.

## Numbers to have ready

| | Before | After |
|---|---|---|
| Attack campaigns caught | 17 of 17 | 17 of 17 |
| Fraud value let through | Rs 67,667 | Rs 67,667 |
| Genuine payments blocked | 39 | 0 |
| Genuine payments challenged | 14 | 39 |
| Genuine payments bothered | 53 of 1,096 (4.8%) | 39 of 1,096 (3.6%) |

Policy change: verify threshold 0.55 to 0.70, block threshold 0.75 to 0.85.

## If something goes wrong

| What you see | What to do |
|---|---|
| Yellow banner "Cannot reach the Fraudverse backend" | The backend is not running. Start it, then click **Retry**. |
| Demo mode shows a red error | Read it aloud, click **Restart demo**. If it repeats, use the **Policy Advisor** page and say you are showing the same loop by hand. |
| The numbers differ from this page | Quote the screen. Do not quote this page. |
| The demo was run before and the policy is not the default | Click **Reset demo** first, then **Start demo**. |
| A page is empty | It needs a run first. Launch one in the Attack Lab. |

## What not to claim

- Not that the models are accurate on real fraud. Everything is synthetic and the models were
  trained on data from the same kind of simulator.
- Not that the improvement will carry over to real payment data.
- Not that the advisor's cost figures are real money. They come from an assumed cost model.
