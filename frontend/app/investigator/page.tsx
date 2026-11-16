"use client";

import { InvestigatorView } from "@/components/InvestigatorView";
import { PageShell } from "@/components/PageShell";
import { useDashboard } from "@/lib/useDashboard";

export default function InvestigatorPage() {
  const { state, loading, error, refresh } = useDashboard();

  return (
    <PageShell
      eyebrow="AI Investigator"
      title="Investigate a flagged payment"
      description="Pick a case to see the stored explanation, the risk factors behind it and the actual transaction features. Explanations are generated from the real feature values, not free text."
      error={error}
      onRetry={refresh}
    >
      {loading ? (
        <p className="text-[14px] text-mute">Loading cases…</p>
      ) : (
        <InvestigatorView cases={state.cases} transactions={state.transactions} />
      )}
    </PageShell>
  );
}
