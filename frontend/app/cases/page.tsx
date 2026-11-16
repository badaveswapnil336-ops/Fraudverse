"use client";

import { CasesTable } from "@/components/CasesTable";
import { EmptyState } from "@/components/EmptyState";
import { PageShell } from "@/components/PageShell";
import { useDashboard } from "@/lib/useDashboard";

export default function CasesPage() {
  const { state, loading, error, refresh } = useDashboard();

  return (
    <PageShell
      eyebrow="Fraud Cases"
      title="Blue Team cases"
      description="Every payment that was challenged or blocked becomes a case, with its risk score, decision and a plain-language explanation."
      error={error}
      onRetry={refresh}
    >
      {loading ? (
        <p className="text-[14px] text-mute">Loading cases…</p>
      ) : state.cases.length ? (
        <section className="panel p-5">
          <CasesTable cases={state.cases} />
        </section>
      ) : (
        <EmptyState
          title="No cases yet"
          hint="Cases are created when a simulated run produces payments that are challenged or blocked."
          actionLabel="Open Attack Lab"
          actionHref="/attack-lab"
        />
      )}
    </PageShell>
  );
}
