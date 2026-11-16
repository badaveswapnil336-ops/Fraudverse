"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { TradeoffChart } from "@/components/TradeoffChart";
import {
  approvedParams,
  formatDelta,
  formatParam,
  money,
  paramLabel,
  pct,
  runTitle,
  secs,
  statusLabel,
  type Delta,
  verdictTone,
} from "@/lib/advisorUtils";
import type { ImpactSet, Proposal } from "@/lib/types";

interface ProposalCardProps {
  proposal: Proposal;
  busy: boolean;
  onApprove: (proposal: Proposal, approved: string[] | undefined, note: string) => Promise<void>;
  onReject: (proposal: Proposal, note: string) => Promise<void>;
}

const sourceLabel: Record<Proposal["source"], string> = {
  builtin: "Built-in advisor",
  claude: "From claude.ai",
  manual: "Entered by hand",
  reset: "Reset",
};

const toneClass = {
  good: "text-up",
  bad: "text-down",
  flat: "text-faint",
};

const statusClass: Record<string, string> = {
  proposed: "border-purple/30 bg-purple/10 text-purple",
  approved: "border-up/30 bg-up/10 text-up",
  partially_approved: "border-up/30 bg-up/10 text-up",
  rejected: "border-down/30 bg-down/10 text-down",
  reset: "border-white/[0.12] bg-white/[0.04] text-mute",
};

function Compare({ before, after, delta }: { before: string; after: string; delta: Delta }) {
  return (
    <div>
      <div className="font-mono text-[12.5px] text-ink">
        <span className="text-mute">{before}</span>
        <span className="px-1.5 text-faint">→</span>
        {after}
      </div>
      <div className={`font-mono text-[11px] ${toneClass[delta.tone]}`}>{delta.text}</div>
    </div>
  );
}

function ImpactTable({ impact }: { impact: ImpactSet[] }) {
  return (
    <div className="mt-5 overflow-x-auto">
      <div className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-dim">
        Measured effect · same transactions, re-decided under each policy
      </div>
      <table className="w-full min-w-[720px] text-left text-[13px]">
        <thead>
          <tr className="font-mono text-[10px] uppercase tracking-[0.1em] text-dim">
            <th className="py-2 pr-3 font-medium">Run</th>
            <th className="px-3 py-2 font-medium">Campaigns caught</th>
            <th className="px-3 py-2 font-medium">Median time to detect</th>
            <th className="px-3 py-2 font-medium">Fraud value let through</th>
            <th className="px-3 py-2 font-medium">Genuine bothered</th>
            <th className="px-3 py-2 font-medium">Expected cost</th>
          </tr>
        </thead>
        <tbody>
          {impact.map((set) => (
            <tr key={set.label} className="border-t border-white/[0.06] align-top">
              <td className="py-3 pr-3">
                <div className="text-ink">{runTitle(set.label)}</div>
                {set.replay_fidelity !== null ? (
                  <div className="font-mono text-[10px] text-faint">
                    replay matches {pct(set.replay_fidelity, 1)}
                  </div>
                ) : null}
              </td>
              <td className="px-3 py-3">
                <Compare
                  before={pct(set.before.campaign_catch_rate, 0)}
                  after={pct(set.after.campaign_catch_rate, 0)}
                  delta={formatDelta(
                    set.before.campaign_catch_rate,
                    set.after.campaign_catch_rate,
                    "pct",
                    false,
                  )}
                />
              </td>
              <td className="px-3 py-3">
                <Compare
                  before={secs(set.before.median_ttd_sec)}
                  after={secs(set.after.median_ttd_sec)}
                  delta={formatDelta(set.before.median_ttd_sec, set.after.median_ttd_sec, "secs", true)}
                />
              </td>
              <td className="px-3 py-3">
                <Compare
                  before={money(set.before.amount_let_through)}
                  after={money(set.after.amount_let_through)}
                  delta={formatDelta(
                    set.before.amount_let_through,
                    set.after.amount_let_through,
                    "money",
                    true,
                  )}
                />
              </td>
              <td className="px-3 py-3">
                <Compare
                  before={pct(set.before.genuine_friction_rate, 2)}
                  after={pct(set.after.genuine_friction_rate, 2)}
                  delta={formatDelta(
                    set.before.genuine_friction_rate,
                    set.after.genuine_friction_rate,
                    "pct",
                    true,
                  )}
                />
              </td>
              <td className="px-3 py-3">
                <Compare
                  before={money(set.cost_before.total)}
                  after={money(set.cost_after.total)}
                  delta={formatDelta(set.cost_before.total, set.cost_after.total, "money", true)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ProposalCard({ proposal, busy, onApprove, onReject }: ProposalCardProps) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(proposal.changes.map((change) => change.param)),
  );
  const [note, setNote] = useState("");

  const open = proposal.status === "proposed";
  const hasChanges = proposal.changes.length > 0;
  const tone = verdictTone(proposal.verdict);
  const chosen = approvedParams(proposal.changes, selected);
  const chosenCount = chosen === undefined ? proposal.changes.length : chosen.length;
  const decision = proposal.audit[proposal.audit.length - 1];

  function toggle(param: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(param)) next.delete(param);
      else next.add(param);
      return next;
    });
  }

  return (
    <article className="panel p-5" data-testid="proposal-card" data-proposal-id={proposal.proposal_id}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em]">
            <span className="text-purple">{proposal.proposal_id}</span>
            <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-dim">
              {sourceLabel[proposal.source]}
            </span>
            <span className="text-faint">run {proposal.run_id}</span>
          </div>
          <h3 className="mt-2 text-lg font-semibold text-ink">
            {hasChanges ? "Proposed policy change" : "No change recommended"}
          </h3>
        </div>
        <span
          data-testid="proposal-status"
          className={`rounded-full border px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.1em] ${
            statusClass[proposal.status] ?? statusClass.reset
          }`}
        >
          {statusLabel(proposal.status)}
        </span>
      </header>

      <p className="mt-3 text-[13.5px] leading-6 text-mute">{proposal.summary}</p>

      {proposal.verdict ? (
        <div
          className={`mt-3 rounded-[10px] border px-3 py-2.5 text-[13px] leading-5 ${
            tone === "good"
              ? "border-up/25 bg-up/[0.06] text-up"
              : "border-[#fbbf24]/30 bg-[#fbbf24]/[0.06] text-[#fbbf24]"
          }`}
        >
          {proposal.verdict.note}
        </div>
      ) : null}

      {hasChanges ? (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-[13px]">
            <thead>
              <tr className="font-mono text-[10px] uppercase tracking-[0.1em] text-dim">
                {open ? <th className="w-8 py-2 font-medium" /> : null}
                <th className="py-2 pr-3 font-medium">Setting</th>
                <th className="px-3 py-2 font-medium">Change</th>
                <th className="px-3 py-2 font-medium">Why</th>
              </tr>
            </thead>
            <tbody>
              {proposal.changes.map((change) => (
                <tr key={change.param} className="border-t border-white/[0.06] align-top">
                  {open ? (
                    <td className="py-3 pr-2">
                      <input
                        type="checkbox"
                        aria-label={`Approve ${paramLabel(change.param)}`}
                        checked={selected.has(change.param)}
                        onChange={() => toggle(change.param)}
                        className="accent-purple"
                      />
                    </td>
                  ) : null}
                  <td className="py-3 pr-3 text-ink">{paramLabel(change.param)}</td>
                  <td className="whitespace-nowrap px-3 py-3 font-mono text-ink">
                    <span className="text-mute">{formatParam(change.param, change.from)}</span>
                    <span className="px-1.5 text-faint">→</span>
                    {formatParam(change.param, change.to)}
                  </td>
                  <td className="px-3 py-3 text-[12.5px] leading-5 text-mute">{change.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {proposal.impact.length ? <ImpactTable impact={proposal.impact} /> : null}
      {proposal.impact.length ? <TradeoffChart impact={proposal.impact} /> : null}

      {proposal.search?.alternatives.length ? (
        <details className="mt-4 text-[13px] text-mute">
          <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.1em] text-dim">
            Other policies the search considered ({proposal.search.evaluated} tried)
          </summary>
          <ul className="mt-2 grid gap-1 font-mono text-[12px]">
            {proposal.search.alternatives.map((candidate, index) => (
              <li key={index}>
                mix {formatParam("supervised_weight", candidate.supervised_weight)} · challenge from{" "}
                {candidate.verify_threshold.toFixed(2)} · block from{" "}
                {candidate.block_threshold.toFixed(2)} → cost {money(candidate.total_cost)}, genuine
                bothered {pct(candidate.friction_rate, 2)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {proposal.cost_model ? (
        <details className="mt-3 text-[13px] text-mute">
          <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.1em] text-dim">
            Cost assumptions used
          </summary>
          <p className="mt-2 leading-6">
            A challenge costs {money(proposal.cost_model.challenge_cost)}. A wrongly declined payment
            loses {pct(proposal.cost_model.false_decline_loss, 0)} of its value. A challenge stops{" "}
            {pct(proposal.cost_model.verify_effectiveness, 0)} of fraud. No policy may bother more than{" "}
            {pct(proposal.cost_model.max_friction_rate, 0)} of genuine payments. These are assumptions,
            not measured business data.
          </p>
        </details>
      ) : null}

      {open ? (
        <footer className="mt-5 flex flex-wrap items-center gap-3 border-t border-white/[0.06] pt-4">
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Note for the audit trail (optional)"
            aria-label="Note for the audit trail"
            className="min-w-[200px] flex-1 rounded border border-white/[0.08] bg-bg px-3 py-2 text-[13px] text-ink outline-none"
          />
          {hasChanges ? (
            <button
              type="button"
              disabled={busy || chosenCount === 0}
              onClick={() => onApprove(proposal, chosen, note)}
              className="inline-flex items-center gap-2 rounded bg-ink px-4 py-2 text-[14px] font-semibold text-bg transition hover:bg-[#e6e8ea] disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
              {chosenCount === proposal.changes.length
                ? "Approve all changes"
                : `Approve ${chosenCount} of ${proposal.changes.length}`}
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => onReject(proposal, note)}
            className="inline-flex items-center gap-2 rounded border border-white/[0.09] bg-white/[0.03] px-4 py-2 text-[14px] text-mute transition hover:bg-white/[0.06] hover:text-ink disabled:opacity-50"
          >
            <X className="h-4 w-4" />
            Reject
          </button>
        </footer>
      ) : decision ? (
        <footer className="mt-5 border-t border-white/[0.06] pt-4 text-[13px] text-mute">
          {statusLabel(proposal.status)} on {new Date(decision.at).toLocaleString("en-IN")}
          {decision.approved_params?.length
            ? ` · applied: ${decision.approved_params.map(paramLabel).join(", ")}`
            : ""}
          {decision.note ? ` · note: ${decision.note}` : ""}
        </footer>
      ) : null}
    </article>
  );
}
