"use client";

import { EmptyState } from "@/components/EmptyState";
import { OrchestrationPanel } from "@/components/OrchestrationPanel";
import { PageShell } from "@/components/PageShell";
import { useDashboard } from "@/lib/useDashboard";

export default function SimulationsPage() {
  const { state, loading, error, refresh, feedback } = useDashboard();
  const latest = state.runs[0] ?? null;

  return (
    <PageShell
      eyebrow="Simulations"
      title="Simulation runs and adaptive loop"
      description="Every launched run is stored. Generate feedback on the latest run to get a harder next-round scenario."
      error={error}
      onRetry={refresh}
    >
      {loading ? (
        <p className="text-[14px] text-mute">Loading runs…</p>
      ) : state.runs.length ? (
        <>
          <section className="panel overflow-hidden">
            <div className="grid grid-cols-[1.4fr_1fr_0.7fr_0.7fr_0.7fr] border-b border-white/[0.06] px-4 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-dim">
              <span>Run</span>
              <span>Attack family</span>
              <span>Transactions</span>
              <span>Fraud</span>
              <span>Flagged</span>
            </div>
            {state.runs.map((run) => (
              <div
                key={run.run_id}
                className="grid grid-cols-[1.4fr_1fr_0.7fr_0.7fr_0.7fr] border-b border-white/[0.04] px-4 py-3 text-[13.5px] text-mute"
              >
                <span className="font-semibold text-ink">{run.run_id}</span>
                <span>{(run.attack_family ?? run.scenario?.attack_family ?? "--").replaceAll("_", " ")}</span>
                <span className="tabular-nums">{run.total_transactions}</span>
                <span className="tabular-nums">{run.fraud_transactions}</span>
                <span className="tabular-nums">{run.flagged_cases ?? "--"}</span>
              </div>
            ))}
          </section>
          <div className="mt-8">
            <OrchestrationPanel
              run={latest}
              feedback={state.feedback}
              nextScenario={state.nextScenario}
              onFeedback={feedback}
            />
          </div>
        </>
      ) : (
        <EmptyState
          title="No simulation runs yet"
          hint="Launch your first attack from the Attack Lab."
          actionLabel="Open Attack Lab"
          actionHref="/attack-lab"
        />
      )}
    </PageShell>
  );
}
