"use client";

import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { AttackLab } from "@/components/AttackLab";
import { useDashboard } from "@/lib/useDashboard";

export default function AttackLabPage() {
  const { state, error, refresh, launch } = useDashboard();
  const latest = state.runs[0];

  return (
    <PageShell
      eyebrow="Attack Lab"
      title="Red Team Lab"
      description="Pick an attack family, volume and fraud share, then launch. The run is generated, scored by both models and stored."
      error={error}
      onRetry={refresh}
    >
      <section className="panel p-5">
        <AttackLab onLaunch={launch} />
      </section>

      {latest ? (
        <section className="panel mt-6 p-5">
          <span className="font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-purple">
            Latest run
          </span>
          <p className="mt-2 text-[14px] text-mute">
            {latest.run_id}: {latest.total_transactions} transactions, {latest.fraud_transactions} fraud
            {latest.flagged_cases !== undefined ? `, ${latest.flagged_cases} flagged` : ""}.
          </p>
          <div className="mt-3 flex flex-wrap gap-3 text-[13px]">
            <Link className="text-purple hover:underline" href="/cases">View cases</Link>
            <Link className="text-purple hover:underline" href="/models">View model results</Link>
            <Link className="text-purple hover:underline" href="/reports">View scorecard</Link>
          </div>
        </section>
      ) : null}
    </PageShell>
  );
}
