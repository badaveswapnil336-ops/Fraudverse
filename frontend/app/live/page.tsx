"use client";

import { EmptyState } from "@/components/EmptyState";
import { PageShell } from "@/components/PageShell";
import { SOCConsole } from "@/components/SOCConsole";
import { TransactionDecisionsTable } from "@/components/TransactionDecisionsTable";
import { useDashboard } from "@/lib/useDashboard";

export default function LivePage() {
  const { state, loading, error, refresh } = useDashboard();

  return (
    <PageShell
      eyebrow="Live Transactions"
      title="Live telemetry and decisions"
      description="The event stream shows each pipeline stage as it happens. The table below lists every scored payment from the latest run with its decision."
      error={error}
      onRetry={refresh}
    >
      <SOCConsole />
      <section className="panel mt-8 p-5">
        <h2 className="mb-4 text-xl font-semibold tracking-[-0.02em] text-ink">Scored transactions</h2>
        {loading ? (
          <p className="text-[14px] text-mute">Loading transactions…</p>
        ) : state.transactions.length ? (
          <TransactionDecisionsTable transactions={state.transactions} />
        ) : (
          <EmptyState
            title="No transactions yet"
            hint="Launch an attack to generate and score a batch of synthetic payments."
            actionLabel="Open Attack Lab"
            actionHref="/attack-lab"
          />
        )}
      </section>
    </PageShell>
  );
}
