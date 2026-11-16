"""Campaign-mode generation: fraud arrives as bursts on a simulated clock.

The original generator (generate_transaction_batch) scatters independent fraud rows through
the stream. That cannot answer "how long until the attack was noticed?". This module builds
the same kind of transactions (same features, same fraud injectors) but groups fraud into
campaigns - several payments on one customer, spread over time - and tags every row so a
scorecard can read it.

Extra fields added to each transaction:
  sim_time_sec  seconds since the start of the run (simulated clock)
  campaign_id   "CMP-001"... for fraud, None for genuine
  scenario_tag  attack family for fraud; "normal", "travel", "new_payee" or
                "spending_spike" for genuine payments (and, with seasonality on,
                "salary_day", "festival_spike" or "weekend_leisure")
  chain_step    1-4, only for the multi_step_takeover family (see inject_fraud.CHAIN_STEPS)

The existing feature values are produced by the original helpers, so the trained models see
the same kind of inputs. Velocity features are still the original independent random values
(they are not derived from the campaign's real timing); see docs/known-limitations.

Seasonality (off by default): the run covers a 30-day simulated month instead of a few hours.
Genuine traffic is heavier on weekends, around month-end salary days and in a festival week,
and part of that traffic carries seasonal behaviour (bigger baskets, more bill payments).
Fraud campaigns start at random times across the month. The calendar and the sizes of the
effects are modelling assumptions, not measurements.
"""
import random

try:
    from .generate_customers import generate_customers
    from .generate_transactions import (
        HARD_NEGATIVE_PROFILES,
        generate_transaction,
        inject_hard_negative,
        inject_seasonal,
    )
    from .inject_fraud import ALL_ATTACK_FAMILIES, ATTACK_FAMILIES, CHAIN_STEPS, inject_fraud
except ImportError:
    from generate_customers import generate_customers
    from generate_transactions import (
        HARD_NEGATIVE_PROFILES,
        generate_transaction,
        inject_hard_negative,
        inject_seasonal,
    )
    from inject_fraud import ALL_ATTACK_FAMILIES, ATTACK_FAMILIES, CHAIN_STEPS, inject_fraud


# seconds between payments inside one campaign: account takeovers are fast, synthetic
# identities build up slowly
FAMILY_GAP_SEC = {
    "account_takeover": (15, 90),
    "ai_social_engineering": (120, 600),
    "synthetic_identity": (300, 1800),
    "card_testing": (5, 40),
    "velocity_burst": (3, 20),
}

# seconds between the steps of a multi-step takeover: step 1->2, 2->3 and 3->4
CHAIN_GAP_SEC = [(300, 2400), (120, 900), (600, 5400)]

# ---- simulated calendar (used only when seasonality is on) ----------------------------
DAY_SEC = 86400
SEASON_DAYS = 30
START_WEEKDAY = 0                       # day 0 is a Monday
FESTIVAL_DAYS = range(11, 18)           # a festival week
MONTH_END_DAYS = {0, 1, 27, 28, 29}     # around salary day
SEASONAL_SHARE = {"festival_spike": 0.5, "salary_day": 0.4, "weekend_leisure": 0.3}


def day_of(sim_time_sec):
    return int(sim_time_sec // DAY_SEC)


def is_weekend(day):
    return (day + START_WEEKDAY) % 7 in (5, 6)


def seasonal_profile_for(day):
    """The seasonal behaviour that applies on this day, or None."""
    if day in FESTIVAL_DAYS:
        return "festival_spike"
    if day in MONTH_END_DAYS:
        return "salary_day"
    if is_weekend(day):
        return "weekend_leisure"
    return None


def day_weights():
    """Relative amount of genuine traffic on each day of the month."""
    weights = []
    for day in range(SEASON_DAYS):
        weight = 1.0
        if is_weekend(day):
            weight *= 1.25
        if day in MONTH_END_DAYS:
            weight *= 2.0
        if day in FESTIVAL_DAYS:
            weight *= 2.5
        weights.append(weight)
    return weights


def _campaign_sizes(rng, n_fraud, low=3, high=8):
    sizes, left = [], n_fraud
    while left > 0:
        size = min(left, rng.randint(low, high))
        sizes.append(size)
        left -= size
    if len(sizes) > 1 and sizes[-1] < low:      # avoid a tiny trailing campaign
        tail = sizes.pop()
        sizes[-1] += tail
    return sizes


def generate_campaign_batch(
    total_transactions: int = 1000,
    fraud_ratio: float = 0.12,
    attack_family: str | None = None,
    customer_count: int = 250,
    evasion_strength: float = 0.0,
    hard_negative_ratio: float = 0.0,
    scenario: dict | None = None,
    seed: int | None = None,
    seasonality: bool = False,
):
    """Generate a time-ordered stream with fraud grouped into campaigns.

    With a `seed`, the result is reproducible (apart from the random ids) and the global
    `random` state is restored afterwards, so a server call cannot disturb other code.
    """
    if total_transactions <= 0:
        raise ValueError("total_transactions must be greater than 0")
    if customer_count <= 0:
        raise ValueError("customer_count must be greater than 0")
    if not 0 <= fraud_ratio <= 1:
        raise ValueError("fraud_ratio must be between 0 and 1")
    if not 0 <= evasion_strength <= 1:
        raise ValueError("evasion_strength must be between 0 and 1")
    if not 0 <= hard_negative_ratio <= 1:
        raise ValueError("hard_negative_ratio must be between 0 and 1")
    if attack_family is not None and attack_family not in ALL_ATTACK_FAMILIES:
        raise ValueError(f"unknown attack_family: {attack_family}")

    saved_state = random.getstate()
    if seed is not None:
        random.seed(seed)          # the shared helpers draw from the global generator
    rng = random.Random(seed)
    try:
        customers = generate_customers(customer_count)

        n_fraud = min(total_transactions, round(total_transactions * fraud_ratio))
        if fraud_ratio > 0 and n_fraud == 0:
            n_fraud = 1
        is_chain = attack_family == "multi_step_takeover"
        if is_chain and n_fraud > 0:
            # whole chains only, so every campaign reaches the large transfer
            n_chains = min(
                max(1, round(n_fraud / len(CHAIN_STEPS))),
                total_transactions // len(CHAIN_STEPS),
            )
            if n_chains == 0:
                raise ValueError(
                    f"multi_step_takeover needs at least {len(CHAIN_STEPS)} transactions"
                )
            n_fraud = n_chains * len(CHAIN_STEPS)
        n_legit = total_transactions - n_fraud
        window = SEASON_DAYS * DAY_SEC if seasonality else max(7200, total_transactions * 30)

        sizes = ([len(CHAIN_STEPS)] * (n_fraud // len(CHAIN_STEPS)) if is_chain
                 else _campaign_sizes(rng, n_fraud))

        transactions, latest = [], 0
        for number, size in enumerate(sizes, start=1):
            family = attack_family or rng.choice(ATTACK_FAMILIES)
            customer = rng.choice(customers)
            t = rng.randint(0, int(window * 0.8))
            for step in range(1, size + 1):
                tx = inject_fraud(
                    generate_transaction(customer),
                    family,
                    evasion_strength=evasion_strength,
                    scenario=scenario,
                    chain_step=step if is_chain else None,
                )
                tx.update(sim_time_sec=t, campaign_id=f"CMP-{number:03d}",
                          scenario_tag=family)
                transactions.append(tx)
                latest = max(latest, t)
                if is_chain:
                    if step < size:
                        t += rng.randint(*CHAIN_GAP_SEC[step - 1])
                else:
                    low, high = FAMILY_GAP_SEC[family]
                    t += rng.randint(low, high)

        horizon = max(window, latest)
        if seasonality:
            weights = day_weights()
            for _ in range(n_legit):
                day = rng.choices(range(SEASON_DAYS), weights=weights)[0]
                tx = generate_transaction(rng.choice(customers))
                tag = "normal"
                profile = seasonal_profile_for(day)
                if profile and rng.random() < SEASONAL_SHARE[profile]:
                    tag = profile
                    tx = inject_seasonal(tx, profile)
                elif hard_negative_ratio and rng.random() < hard_negative_ratio:
                    tag = rng.choice(HARD_NEGATIVE_PROFILES)
                    tx = inject_hard_negative(tx, tag)
                tx.update(sim_time_sec=day * DAY_SEC + rng.randint(0, DAY_SEC - 1),
                          campaign_id=None, scenario_tag=tag)
                transactions.append(tx)
        else:
            for _ in range(n_legit):
                tx = generate_transaction(rng.choice(customers))
                tag = "normal"
                if hard_negative_ratio and rng.random() < hard_negative_ratio:
                    tag = rng.choice(HARD_NEGATIVE_PROFILES)
                    tx = inject_hard_negative(tx, tag)
                tx.update(sim_time_sec=rng.randint(0, horizon), campaign_id=None,
                          scenario_tag=tag)
                transactions.append(tx)
    finally:
        if seed is not None:
            random.setstate(saved_state)

    # stable sort on time only: ties keep generation order (ids are random, so sorting on
    # them would make a seeded run non-reproducible)
    transactions.sort(key=lambda t: t["sim_time_sec"])
    return transactions
