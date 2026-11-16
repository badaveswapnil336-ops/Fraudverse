"use client";

import { ShieldCheck, ShieldX, Target, Timer } from "lucide-react";
import { MetricCard } from "@/components/MetricCard";
import { money, pct, secs, titleCase } from "@/lib/advisorUtils";
import type { Scorecard } from "@/lib/types";

interface ScorecardPanelProps {
  scorecard: Scorecard | null;
  error: string | null;
  loading: boolean;
}

const th = "py-2 pr-3 font-medium";

export function ScorecardPanel({ scorecard, error, loading }: ScorecardPanelProps) {
  if (loading) {
    return <div className="panel p-5 text-[14px] text-mute">Loading scorecard…</div>;
  }

  if (error) {
    return (
      <div className="panel border-[#fbbf24]/30 p-5">
        <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-[#fbbf24]">
          Scorecard unavailable
        </div>
        <p className="mt-2 text-[14px] text-mute">{error}</p>
      </div>
    );
  }

  if (!scorecard) {
    return (
      <div className="panel p-5 text-[14px] text-mute">
        Pick a run, or generate some, to see its scorecard.
      </div>
    );
  }

  const { attacks: a, genuine: g } = scorecard;

  return (
    <div data-testid="scorecard">
      {!a.campaign_data ? (
        <div className="mb-3 rounded-[10px] border border-[#fbbf24]/30 bg-[#fbbf24]/[0.06] px-3 py-2.5 text-[13px] text-[#fbbf24]">
          This run was launched without campaign mode, so campaign counts and time to detect are not
          available. Payment-level figures below still apply.
        </div>
      ) : null}

      <section className="grid gap-px overflow-hidden rounded-[14px] border border-white/[0.06] bg-white/[0.06] md:grid-cols-4">
        <MetricCard
          label="Attack campaigns caught"
          value={a.campaign_data ? `${a.campaigns_caught}/${a.campaigns}` : "--"}
          detail={a.campaign_data ? `${pct(a.catch_rate)} of campaigns` : `${pct(a.stop_rate)} of fraud payments stopped`}
          tone="green"
          icon={Target}
        />
        <MetricCard
          label="Median time to detect"
          value={secs(a.median_ttd_sec)}
          detail={`slowest 1 in 10: ${secs(a.p90_ttd_sec)}`}
          tone="amber"
          icon={Timer}
        />
        <MetricCard
          label="Fraud value let through"
          value={money(a.amount_let_through)}
          detail={`of ${money(a.amount_total)} attempted`}
          tone="red"
          icon={ShieldX}
        />
        <MetricCard
          label="Genuine payments bothered"
          value={pct(g.friction_rate, 2)}
          detail={`${g.blocked} blocked · ${g.challenged} challenged · ${g.customers_impacted} customers`}
          tone="violet"
          icon={ShieldCheck}
        />
      </section>

      {a.chains ? (
        <div className="panel mt-5 p-5" data-testid="chain-summary">
          <div className="font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-purple">
            Multi-step takeovers
          </div>
          <p className="mt-2 text-[14px] text-mute">
            {a.chains_stopped_before_transfer ?? 0} of {a.chains} chains were stopped before the large
            transfer. First stopped at: account change {a.chain_first_stop_step?.["1"] ?? 0}, new payee{" "}
            {a.chain_first_stop_step?.["2"] ?? 0}, test payment {a.chain_first_stop_step?.["3"] ?? 0}, large
            transfer {a.chain_first_stop_step?.["4"] ?? 0}, never {a.chain_first_stop_step?.never ?? 0}.
          </p>
        </div>
      ) : null}

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <div className="panel overflow-x-auto p-5">
          <div className="mb-3 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-purple">
            By attack type
          </div>
          <table className="w-full min-w-[420px] text-left text-[13px]">
            <thead>
              <tr className="font-mono text-[10px] uppercase tracking-[0.1em] text-dim">
                <th className={th}>Attack</th>
                <th className={th}>Caught</th>
                <th className={th}>Median detect</th>
                <th className={th}>Let through</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(a.by_family).map(([family, s]) => (
                <tr key={family} className="border-t border-white/[0.06]">
                  <td className="py-2.5 pr-3 text-ink">{titleCase(family)}</td>
                  <td className="py-2.5 pr-3 font-mono">
                    {s.campaigns_caught}/{s.campaigns} <span className="text-faint">({pct(s.catch_rate, 0)})</span>
                  </td>
                  <td className="py-2.5 pr-3 font-mono">{secs(s.median_ttd_sec)}</td>
                  <td className="py-2.5 pr-3 font-mono">{money(s.amount_let_through)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel overflow-x-auto p-5">
          <div className="mb-3 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-purple">
            Genuine customers by behaviour
          </div>
          <table className="w-full min-w-[420px] text-left text-[13px]">
            <thead>
              <tr className="font-mono text-[10px] uppercase tracking-[0.1em] text-dim">
                <th className={th}>Behaviour</th>
                <th className={th}>Payments</th>
                <th className={th}>Blocked</th>
                <th className={th}>Challenged</th>
                <th className={th}>Bothered</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(g.by_scenario).map(([scenario, s]) => (
                <tr key={scenario} className="border-t border-white/[0.06]">
                  <td className="py-2.5 pr-3 text-ink">{titleCase(scenario)}</td>
                  <td className="py-2.5 pr-3 font-mono">{s.payments}</td>
                  <td className="py-2.5 pr-3 font-mono">{s.blocked}</td>
                  <td className="py-2.5 pr-3 font-mono">{s.challenged}</td>
                  <td className="py-2.5 pr-3 font-mono">{pct(s.friction_rate, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
