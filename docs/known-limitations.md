# Known limitations

## Campaign mode and the scorecard

- **Velocity features are not derived from campaign timing.** Campaign mode groups fraud
  into bursts on a simulated clock, but `velocity_10m` and `velocity_24h` keep the original
  independent random values so the trained models see the same kind of inputs. Time to
  detect is therefore measured on the campaign clock, not on real velocity counts.
- **`transaction_hour` is still random** and is not tied to `sim_time_sec`.
- **Each payment is scored on its own.** The models do not look at earlier payments on the
  same customer, so a campaign is "caught" as soon as any one of its payments is flagged.
- **A campaign is caught on VERIFY or BLOCK.** MONITOR counts as let through, matching how
  Fraudverse opens cases.
- **All data is synthetic.** Every figure describes the synthetic benchmark, not real fraud.

## Advisor

- **The cost model is an assumption**, not measured business data. See
  `docs/advanced-features.md` for the defaults and how to change them.
- **Tuning on one run can over-fit it.** The advisor checks other runs when they exist and
  says plainly when it could not.
- **A challenge is assumed to stop most fraud.** `verify_effectiveness` defaults to 0.85. For
  attacks where the real customer approves an OTP (AI social engineering), this is optimistic.
- **The endpoint code was tested against a stand-in for FastAPI and stand-in model scores**,
  not against the running Fraudverse stack and the trained models.

## Seasonality, multi-step chains and the added attack families

- **The calendar and effect sizes are assumptions.** Seasonality uses a 30-day simulated month
  starting on a Monday, a festival week on days 12 to 18, month-end salary days around the
  turn of the month, and weekend evenings. How much bigger payments get (for example 1.3 to
  2.1 times a customer's average in festival week) was chosen, not measured. No source for
  these numbers was verified. See `docs/fraud-typologies.md`.
- **The shipped models are weak on seasonal peaks.** They were trained without seasonal
  behaviour. On seeded runs they block most festival-week payments and a large share of
  salary-day payments, as they already do for the older "spending spike" profile. The
  scorecard shows this per behaviour. A test for the target (under 10 percent friction) is
  marked as an expected failure until the models are retrained on seasonal data.
- **Models were not retrained for the new families.** `card_testing`, `velocity_burst` and
  `multi_step_takeover` are scored by models trained on the original data. How well they catch
  these families is whatever those models happen to do. It is not evidence about real fraud.
- **Multi-step steps are expressed through payment features.** The account change is a
  near-zero payment from a new device. The models still score each payment on its own, so they
  do not see the sequence. A chain is stopped as soon as one of its payments is flagged.
- **Attack and genuine behaviour are only as realistic as their parameters.** Seeded runs are
  repeatable, but repeatable is not the same as realistic.
