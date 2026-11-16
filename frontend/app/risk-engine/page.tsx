"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { DetectionRateChart, FraudDistributionChart } from "@/components/DashboardCharts";
import { PageShell } from "@/components/PageShell";
import { PolicyCard } from "@/components/PolicyCard";
import { getPolicy, resetPolicy } from "@/lib/api";
import { errorMessage } from "@/lib/advisorUtils";
import type { PolicyResponse } from "@/lib/types";
import { useDashboard } from "@/lib/useDashboard";

export default function RiskEnginePage() {
  const { state, error, refresh } = useDashboard();
  const [policy, setPolicy] = useState<PolicyResponse | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadPolicy = useCallback(async () => {
    try {
      setPolicy(await getPolicy());
      setPolicyError(null);
    } catch (caught) {
      setPolicyError(errorMessage(caught));
    }
  }, []);

  useEffect(() => {
    void loadPolicy();
  }, [loadPolicy]);

  async function onReset() {
    if (!window.confirm("Reset the risk policy to the shipped defaults?")) return;
    setBusy(true);
    try {
      await resetPolicy("Reset from Risk Engine page");
      await loadPolicy();
      toast.success("Policy reset to defaults.");
    } catch (caught) {
      toast.error(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const weight = policy?.active.supervised_weight;

  return (
    <PageShell
      eyebrow="Risk Engine"
      title="How a score becomes a decision"
      description="Two models score every payment. Their outputs are fused into one risk score, and the active policy turns that score into ALLOW, MONITOR, VERIFY or BLOCK."
      error={error ?? policyError}
      onRetry={() => {
        void refresh();
        void loadPolicy();
      }}
    >
      <section className="panel p-5">
        <h2 className="text-xl font-semibold tracking-[-0.02em] text-ink">Score fusion</h2>
        <p className="mt-2 font-mono text-[13.5px] text-mute">
          {weight !== undefined
            ? `risk = ${weight.toFixed(2)} × XGBoost fraud probability + ${(1 - weight).toFixed(2)} × normalised anomaly score`
            : "Loading the active policy…"}
        </p>
      </section>

      <div className="mt-6">
        <PolicyCard policy={policy} busy={busy} onReset={onReset} />
      </div>

      <section className="mt-6 grid gap-5 xl:grid-cols-[1.4fr_0.8fr]">
        <article className="panel p-5">
          <h2 className="mb-4 text-xl font-semibold tracking-[-0.02em] text-ink">Detection rate</h2>
          <DetectionRateChart cases={state.cases} transactions={state.transactions} feedback={state.feedback} />
        </article>
        <article className="panel p-5">
          <h2 className="text-xl font-semibold tracking-[-0.02em] text-ink">Synthetic traffic mix</h2>
          <FraudDistributionChart transactions={state.transactions} />
        </article>
      </section>
    </PageShell>
  );
}
