"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Sparkles, Swords } from "lucide-react";
import { toast } from "sonner";
import { ClaudeAdvisorBox } from "@/components/ClaudeAdvisorBox";
import { PolicyCard } from "@/components/PolicyCard";
import { ProposalCard } from "@/components/ProposalCard";
import { ScorecardPanel } from "@/components/ScorecardPanel";
import { errorMessage, paramLabel, runTitle, type ParsedReply } from "@/lib/advisorUtils";
import {
  approveProposal,
  getPolicy,
  getRuns,
  getScorecard,
  importSuggestions,
  launchAttack,
  listProposals,
  rejectProposal,
  resetPolicy,
  suggestPolicy,
} from "@/lib/api";
import type {
  AttackFamily,
  CostModelValues,
  PolicyResponse,
  Proposal,
  Scorecard,
  SimulationRun,
} from "@/lib/types";

const FAMILIES: AttackFamily[] = [
  "account_takeover",
  "ai_social_engineering",
  "synthetic_identity",
  "card_testing",
  "velocity_burst",
  "multi_step_takeover",
];
const DEFAULT_COST: CostModelValues = {
  challenge_cost: 25,
  false_decline_loss: 0.4,
  verify_effectiveness: 0.85,
  max_friction_rate: 0.05,
};
const COST_FIELDS: Array<[keyof CostModelValues, string, number]> = [
  ["challenge_cost", "Cost of one challenge (Rs)", 1],
  ["false_decline_loss", "Loss when a genuine payment is declined (share of value)", 0.05],
  ["verify_effectiveness", "Share of fraud a challenge stops", 0.05],
  ["max_friction_rate", "Most genuine payments we accept bothering", 0.01],
];

export function AdvisorConsole() {
  const [runs, setRuns] = useState<SimulationRun[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [scorecard, setScorecard] = useState<Scorecard | null>(null);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [scoreLoading, setScoreLoading] = useState(false);
  const [policy, setPolicy] = useState<PolicyResponse | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [cost, setCost] = useState<CostModelValues>(DEFAULT_COST);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reloadBasics = useCallback(async () => {
    const [runList, pol, props] = await Promise.all([getRuns(), getPolicy(), listProposals(20)]);
    setRuns(runList.runs);
    setPolicy(pol);
    setProposals(props.proposals);
    return runList.runs;
  }, []);

  useEffect(() => {
    reloadBasics()
      .then((list) => {
        setLoadError(null);
        if (list.length) setRunId((current) => current ?? list[0].run_id);
      })
      .catch((error) => setLoadError(errorMessage(error)));
  }, [reloadBasics]);

  useEffect(() => {
    if (!runId) {
      setScorecard(null);
      return;
    }
    let cancelled = false;
    setScoreLoading(true);
    setScoreError(null);
    getScorecard(runId)
      .then((card) => !cancelled && setScorecard(card))
      .catch((error) => {
        if (!cancelled) {
          setScorecard(null);
          setScoreError(errorMessage(error));
        }
      })
      .finally(() => !cancelled && setScoreLoading(false));
    return () => {
      cancelled = true;
    };
  }, [runId]);

  async function guarded(label: string, work: () => Promise<void>) {
    setBusy(true);
    setStatus(label);
    try {
      await work();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }

  const generateRuns = () =>
    guarded("Generating three scored runs…", async () => {
      const base = Math.floor(Math.random() * 9000) + 1000;
      let first: SimulationRun | null = null;
      for (let i = 0; i < FAMILIES.length; i += 1) {
        setStatus(`Generating run ${i + 1} of ${FAMILIES.length}…`);
        const run = await launchAttack({
          attack_family: FAMILIES[i],
          volume: 600,
          fraud_ratio: 0.1,
          score_all: true,
          campaign_mode: true,
          seed: base + i,
        });
        first = first ?? run;
      }
      const list = await reloadBasics();
      setRunId(first?.run_id ?? list[0]?.run_id ?? null);
      toast.success("Runs ready. Ask the advisor for a suggestion.");
    });

  const askAdvisor = () =>
    guarded("Searching policies and checking them on other runs…", async () => {
      const proposal = await suggestPolicy({
        run_id: runId ?? undefined,
        validation_runs: 3,
        cost,
      });
      setProposals((current) => [proposal, ...current.filter((p) => p.proposal_id !== proposal.proposal_id)]);
      toast.success(proposal.changes.length ? "Advisor has a suggestion for you to review." : "Advisor found nothing worth changing.");
    });

  const importReply = (reply: ParsedReply) =>
    new Promise<void>((resolve, reject) => {
      setBusy(true);
      importSuggestions({
        run_id: runId ?? undefined,
        source: "claude",
        summary: reply.summary,
        changes: reply.changes,
        validation_runs: 3,
        cost,
      })
        .then((proposal) => {
          setProposals((current) => [proposal, ...current]);
          toast.success("Claude's suggestion measured. Review it below.");
          resolve();
        })
        .catch(reject)
        .finally(() => setBusy(false));
    });

  const approve = (proposal: Proposal, approved: string[] | undefined, note: string) =>
    guarded("Applying…", async () => {
      const result = await approveProposal(proposal.proposal_id, {
        approved_params: approved,
        note: note || undefined,
      });
      setProposals((current) =>
        current.map((p) => (p.proposal_id === result.proposal.proposal_id ? result.proposal : p)),
      );
      setPolicy(await getPolicy());
      const names = (approved ?? proposal.changes.map((c) => c.param)).map(paramLabel).join(", ");
      toast.success(`Approved: ${names}. New runs use the updated policy.`);
    });

  const reject = (proposal: Proposal, note: string) =>
    guarded("Rejecting…", async () => {
      const result = await rejectProposal(proposal.proposal_id, note || undefined);
      setProposals((current) =>
        current.map((p) => (p.proposal_id === result.proposal_id ? result : p)),
      );
      toast.success("Proposal rejected. Policy unchanged.");
    });

  const reset = () => {
    if (!window.confirm("Reset the risk policy to its defaults?")) return;
    void guarded("Resetting…", async () => {
      await resetPolicy("Reset from advisor screen");
      await reloadBasics();
      toast.success("Policy reset to defaults.");
    });
  };

  return (
    <div className="mx-auto max-w-[1400px] py-6">
      <header className="mb-6">
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-purple">
          Policy Advisor
        </span>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.02em] text-ink">
          Test, tune and prove it
        </h1>
        <p className="mt-2 max-w-[760px] text-[14px] leading-6 text-mute">
          Run synthetic attacks and unusual-but-genuine customers through the risk engine, read the
          scorecard, then review a suggested policy change. Nothing is applied until you approve it,
          and every suggestion is measured on the same transactions before you decide. All data here
          is synthetic.
        </p>
      </header>

      {loadError ? (
        <div role="alert" className="panel mb-5 border-[#fbbf24]/30 p-4 text-[14px] text-[#fbbf24]">
          Could not load from the backend: {loadError}
        </div>
      ) : null}

      <section className="panel mb-5 flex flex-wrap items-center gap-3 p-4">
        <button
          type="button"
          onClick={generateRuns}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded border border-white/[0.09] bg-white/[0.03] px-4 py-2 text-[14px] text-ink transition hover:bg-white/[0.06] disabled:opacity-50"
        >
          <Swords className="h-4 w-4" />
          Generate 3 scored runs
        </button>

        <select
          aria-label="Run to analyse"
          value={runId ?? ""}
          onChange={(event) => setRunId(event.target.value || null)}
          disabled={!runs.length}
          className="min-w-[240px] rounded border border-white/[0.08] bg-bg px-3 py-2 text-[14px] text-ink outline-none"
        >
          {!runs.length ? <option value="">No runs yet</option> : null}
          {runs.map((run) => (
            <option key={run.run_id} value={run.run_id}>
              {runTitle(run.run_id)}
              {run.attack_family ? ` · ${run.attack_family.replace(/_/g, " ")}` : ""} · {run.total_transactions} payments
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={askAdvisor}
          disabled={busy || !runId}
          className="inline-flex items-center gap-2 rounded bg-ink px-4 py-2 text-[14px] font-semibold text-bg transition hover:bg-[#e6e8ea] disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Ask the advisor
        </button>

        {status ? (
          <span role="status" className="text-[13px] text-mute">
            {status}
          </span>
        ) : null}

        <details className="w-full text-[13px] text-mute">
          <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.1em] text-dim">
            Cost assumptions (editable)
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {COST_FIELDS.map(([key, label, step]) => (
              <label key={key} className="grid gap-1">
                <span>{label}</span>
                <input
                  type="number"
                  step={step}
                  min={0}
                  value={cost[key]}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setCost((current) => ({ ...current, [key]: Number.isFinite(value) ? value : current[key] }));
                  }}
                  className="rounded border border-white/[0.08] bg-bg px-3 py-2 font-mono text-ink outline-none"
                />
              </label>
            ))}
          </div>
          <p className="mt-2 text-faint">
            These are assumptions, not measured business figures. Change them to match your own costs.
          </p>
        </details>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-5">
          <ScorecardPanel scorecard={scorecard} error={scoreError} loading={scoreLoading} />

          <section aria-label="Advisor proposals" className="space-y-5">
            {proposals.length === 0 ? (
              <div className="panel p-5 text-[14px] text-mute">
                No proposals yet. Generate runs, pick one, and ask the advisor.
              </div>
            ) : (
              proposals.map((proposal) => (
                <ProposalCard
                  key={`${proposal.proposal_id}:${proposal.status}`}
                  proposal={proposal}
                  busy={busy}
                  onApprove={approve}
                  onReject={reject}
                />
              ))
            )}
          </section>
        </div>

        <aside className="space-y-5">
          <PolicyCard policy={policy} busy={busy} onReset={reset} />
          <ClaudeAdvisorBox runId={runId} busy={busy} onImport={importReply} />
        </aside>
      </div>
    </div>
  );
}
