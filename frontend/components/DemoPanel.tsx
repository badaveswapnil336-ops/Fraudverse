"use client";

import { useState } from "react";
import { Play, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { ProposalCard } from "@/components/ProposalCard";
import {
  approveProposal,
  getScorecard,
  launchAttack,
  rejectProposal,
  resetPolicy,
  suggestPolicy,
} from "@/lib/api";
import { errorMessage, money, pct } from "@/lib/advisorUtils";
import {
  DEMO_RUNS,
  DEMO_VOLUME,
  frictionRate,
  predictedFromProposal,
  sameTraffic,
  summarize,
  type DemoTotals,
  type Predicted,
} from "@/lib/demo";
import type { Proposal } from "@/lib/types";

type Phase = "idle" | "baseline" | "ready" | "asking" | "proposal" | "after" | "done" | "rejected";

interface DemoPanelProps {
  /** Called after runs were launched so the rest of the dashboard can refresh. */
  onChanged: () => void | Promise<void>;
}

async function runAll(
  onProgress: (done: number) => void,
): Promise<{ ids: string[]; totals: DemoTotals }> {
  const ids: string[] = [];
  const cards = [];

  for (const [index, spec] of DEMO_RUNS.entries()) {
    onProgress(index);
    const run = await launchAttack({
      attack_family: spec.attack_family,
      seed: spec.seed,
      volume: DEMO_VOLUME,
      score_all: true,
      campaign_mode: true,
    });
    ids.push(run.run_id);
    cards.push(await getScorecard(run.run_id));
  }

  onProgress(DEMO_RUNS.length);
  return { ids, totals: summarize(cards) };
}

export function DemoPanel({ onChanged }: DemoPanelProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [baseIds, setBaseIds] = useState<string[]>([]);
  const [before, setBefore] = useState<DemoTotals | null>(null);
  const [after, setAfter] = useState<DemoTotals | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false);

  const busyPhase = phase === "baseline" || phase === "asking" || phase === "after";

  function clear() {
    setBaseIds([]);
    setBefore(null);
    setAfter(null);
    setProposal(null);
    setError(null);
    setProgress(0);
  }

  async function start() {
    clear();
    setPhase("baseline");
    try {
      await resetPolicy("Demo mode: start from the shipped defaults");
      const result = await runAll(setProgress);
      setBaseIds(result.ids);
      setBefore(result.totals);
      setPhase("ready");
      await onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
      setPhase("idle");
    }
  }

  async function ask() {
    setPhase("asking");
    setError(null);
    try {
      const result = await suggestPolicy({
        run_id: baseIds[0],
        validation_run_ids: baseIds.slice(1),
      });
      setProposal(result);
      setPhase("proposal");
    } catch (caught) {
      setError(errorMessage(caught));
      setPhase("ready");
    }
  }

  async function onApprove(item: Proposal, approved: string[] | undefined, note: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await approveProposal(item.proposal_id, { approved_params: approved, note });
      setProposal(result.proposal);
      setPhase("after");
      setProgress(0);
      const rerun = await runAll(setProgress);
      setAfter(rerun.totals);
      setPhase("done");
      await onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
      setPhase("proposal");
    } finally {
      setBusy(false);
    }
  }

  async function onReject(item: Proposal, note: string) {
    setBusy(true);
    try {
      setProposal(await rejectProposal(item.proposal_id, note));
      setPhase("rejected");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      await resetPolicy("Demo mode: reset");
      clear();
      setPhase("idle");
      toast.success("Demo reset. The risk policy is back to the shipped defaults.");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const predicted = proposal && phase === "done" ? predictedFromProposal(proposal, DEMO_RUNS.length) : null;

  return (
    <section id="demo" className="panel mt-6 scroll-mt-4 p-5" data-testid="demo-panel">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-purple">
            Demo mode
          </span>
          <h2 className="mt-2 text-xl font-semibold tracking-[-0.02em] text-ink md:text-[22px]">
            Weak baseline, advisor, approval, measured improvement
          </h2>
          <p className="mt-2 max-w-[760px] text-[13.5px] leading-6 text-mute">
            Runs {DEMO_RUNS.length} fixed-seed attack runs ({DEMO_VOLUME} payments each) under the shipped
            policy, asks the advisor for a better one, lets you approve it, then replays the same seeds. The
            payments are identical both times, so any difference comes from the policy alone. Synthetic data.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={start}
            disabled={busyPhase || busy}
            className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-bg transition hover:bg-[#e6e8ea] disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            {phase === "idle" ? "Start demo" : "Restart demo"}
          </button>
          {phase !== "idle" ? (
            <button
              type="button"
              onClick={reset}
              disabled={busyPhase || busy}
              className="inline-flex items-center gap-2 rounded-lg border border-white/[0.09] bg-white/[0.03] px-4 py-2.5 text-sm text-mute transition hover:text-ink disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset demo
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-[10px] border border-down/30 bg-down/[0.06] px-3 py-2.5 text-[13px] text-down">
          {error}
        </div>
      ) : null}

      {phase === "baseline" || phase === "after" ? (
        <p className="mt-4 text-[14px] text-mute" role="status">
          {phase === "baseline" ? "Step 1 of 4: running the baseline" : "Step 4 of 4: re-running with the approved policy"}
          {" "}
          ({Math.min(progress + 1, DEMO_RUNS.length)} of {DEMO_RUNS.length}). Each run scores {DEMO_VOLUME} payments, so
          this takes a little while.
        </p>
      ) : null}

      {before && phase !== "baseline" ? (
        <TotalsBlock title="Baseline under the shipped policy" totals={before} />
      ) : null}

      {phase === "ready" ? (
        <div className="mt-4">
          <button
            type="button"
            onClick={ask}
            className="rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-bg transition hover:bg-[#e6e8ea]"
          >
            Step 2: ask the advisor
          </button>
        </div>
      ) : null}

      {phase === "asking" ? (
        <p className="mt-4 text-[14px] text-mute" role="status">
          Step 2 of 4: the advisor is testing policy settings on the three baseline runs…
        </p>
      ) : null}

      {proposal && (phase === "proposal" || phase === "after" || phase === "done" || phase === "rejected") ? (
        <div className="mt-5">
          <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.1em] text-dim">
            {phase === "proposal" ? "Step 3 of 4: review, then approve or reject" : "Advisor proposal"}
          </div>
          <ProposalCard proposal={proposal} busy={busy || phase === "after"} onApprove={onApprove} onReject={onReject} />
        </div>
      ) : null}

      {phase === "rejected" ? (
        <p className="mt-4 text-[13.5px] text-mute">
          Proposal rejected, so the policy is unchanged. Restart the demo to try again.
        </p>
      ) : null}

      {before && after && phase === "done" ? (
        <Comparison before={before} after={after} predicted={predicted} />
      ) : null}
    </section>
  );
}

function TotalsBlock({ title, totals }: { title: string; totals: DemoTotals }) {
  const friction = frictionRate(totals);
  return (
    <div className="mt-5 rounded-[10px] border border-white/[0.06] bg-raise p-4">
      <div className="font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-purple">{title}</div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Attack campaigns caught" value={`${totals.campaignsCaught} of ${totals.campaigns}`} />
        <Stat label="Fraud value let through" value={money(totals.amountLetThrough)} />
        <Stat
          label="Genuine payments blocked"
          value={`${totals.genuineBlocked} of ${totals.genuinePayments}`}
        />
        <Stat
          label="Genuine blocked or challenged"
          value={`${totals.genuineBlocked + totals.genuineChallenged} (${pct(friction)})`}
        />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-dim">{label}</div>
      <div className="mt-1 font-mono text-lg font-semibold text-ink tabular-nums">{value}</div>
    </div>
  );
}

function Comparison({
  before,
  after,
  predicted,
}: {
  before: DemoTotals;
  after: DemoTotals;
  predicted: Predicted | null;
}) {
  const same = sameTraffic(before, after);
  const rows: Array<[string, string, string, string]> = [
    [
      "Attack campaigns caught",
      `${before.campaignsCaught} of ${before.campaigns}`,
      `${after.campaignsCaught} of ${after.campaigns}`,
      predicted ? `${predicted.campaignsCaught}` : "--",
    ],
    [
      "Fraud value let through",
      money(before.amountLetThrough),
      money(after.amountLetThrough),
      predicted ? money(predicted.amountLetThrough) : "--",
    ],
    ["Genuine payments blocked", String(before.genuineBlocked), String(after.genuineBlocked), "--"],
    ["Genuine payments challenged", String(before.genuineChallenged), String(after.genuineChallenged), "--"],
    ["Genuine friction rate", pct(frictionRate(before)), pct(frictionRate(after)), "--"],
  ];

  return (
    <div className="mt-6" data-testid="demo-comparison">
      <div className="font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-purple">
        Before vs after (measured on new runs with the approved policy)
      </div>
      <div className="mt-3 overflow-hidden rounded-[10px] border border-white/[0.06] bg-raise">
        <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr] border-b border-white/[0.06] px-4 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-dim">
          <span>Measure</span>
          <span>Before</span>
          <span>After</span>
          <span>Advisor predicted</span>
        </div>
        {rows.map(([label, b, a, p]) => (
          <div
            key={label}
            className="grid grid-cols-[1.5fr_1fr_1fr_1fr] border-b border-white/[0.04] px-4 py-3 text-[13.5px]"
          >
            <span className="text-mute">{label}</span>
            <span className="font-mono tabular-nums text-mute">{b}</span>
            <span className="font-mono font-semibold tabular-nums text-ink">{a}</span>
            <span className="font-mono tabular-nums text-faint">{p}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[12.5px] leading-5 text-faint">
        {same
          ? "Both sets contain exactly the same payments (same seeds), so the differences come from the policy alone. "
          : "Warning: the two sets do not contain the same payments, so do not read the differences as the effect of the policy. "}
        The cost model behind the advisor is an assumption, shown in the proposal above. Synthetic benchmark, not real
        fraud performance.
      </p>
    </div>
  );
}
