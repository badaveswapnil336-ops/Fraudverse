"use client";

import { EmptyState } from "@/components/EmptyState";
import { ModelEvaluation } from "@/components/ModelEvaluation";
import { PageShell } from "@/components/PageShell";
import { useDashboard } from "@/lib/useDashboard";

export default function ModelsPage() {
  const { state, loading, error, refresh } = useDashboard();
  const version = state.cases[0]?.model_version;

  return (
    <PageShell
      eyebrow="Models"
      title="Model evaluation"
      description={`XGBoost learns known fraud patterns and Isolation Forest flags unusual behaviour. Results are measured against the synthetic ground-truth labels of the latest run${version ? ` (model version ${version})` : ""}.`}
      error={error}
      onRetry={refresh}
    >
      {loading ? (
        <p className="text-[14px] text-mute">Loading results…</p>
      ) : state.transactions.length ? (
        <ModelEvaluation transactions={state.transactions} />
      ) : (
        <EmptyState
          title="Nothing to evaluate yet"
          hint="Launch an attack so the models have labelled transactions to be measured on."
          actionLabel="Open Attack Lab"
          actionHref="/attack-lab"
        />
      )}
    </PageShell>
  );
}
