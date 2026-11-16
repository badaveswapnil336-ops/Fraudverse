"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { PageShell } from "@/components/PageShell";
import { ScorecardPanel } from "@/components/ScorecardPanel";
import { getScorecard } from "@/lib/api";
import { errorMessage } from "@/lib/advisorUtils";
import type { FraudCase, Scorecard } from "@/lib/types";
import { useDashboard } from "@/lib/useDashboard";

function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function casesToCsv(cases: FraudCase[]): string {
  const header = ["case_id", "transaction_id", "decision", "risk_level", "risk_score", "xgboost_score", "anomaly_score", "explanation"];
  const rows = cases.map((item) =>
    [item.case_id, item.transaction_id, item.decision, item.risk_level, item.risk_score, item.xgboost_score, item.anomaly_score, item.explanation]
      .map((value) => `"${String(value).replaceAll('"', '""')}"`)
      .join(","),
  );
  return [header.join(","), ...rows].join("\n");
}

const buttonClass =
  "inline-flex items-center gap-2 rounded border border-white/[0.09] bg-white/[0.03] px-3 py-1.5 text-[13px] text-mute transition hover:bg-white/[0.06] hover:text-ink disabled:opacity-50";

export default function ReportsPage() {
  const { state, loading, error, refresh } = useDashboard();
  const [runId, setRunId] = useState<string>("");
  const [scorecard, setScorecard] = useState<Scorecard | null>(null);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [scoreLoading, setScoreLoading] = useState(false);

  const activeRun = runId || state.runs[0]?.run_id || "";

  useEffect(() => {
    if (!activeRun) return;
    setScoreLoading(true);
    getScorecard(activeRun)
      .then((card) => {
        setScorecard(card);
        setScoreError(null);
      })
      .catch((caught) => {
        setScorecard(null);
        setScoreError(errorMessage(caught));
      })
      .finally(() => setScoreLoading(false));
  }, [activeRun]);

  return (
    <PageShell
      eyebrow="Reports"
      title="Run scorecard and exports"
      description="Attack campaigns caught or missed, time to detect, fraud value let through and genuine payments challenged, for any stored run. Everything here is synthetic."
      error={error}
      onRetry={refresh}
    >
      {loading ? (
        <p className="text-[14px] text-mute">Loading runs…</p>
      ) : !state.runs.length ? (
        <EmptyState
          title="No runs to report on"
          hint="Launch an attack to create a run with a scorecard."
          actionLabel="Open Attack Lab"
          actionHref="/attack-lab"
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[13px] text-mute">
              Run
              <select
                value={activeRun}
                onChange={(event) => setRunId(event.target.value)}
                className="rounded border border-white/[0.09] bg-raise px-2 py-1.5 text-ink"
              >
                {state.runs.map((run) => (
                  <option key={run.run_id} value={run.run_id}>
                    {run.run_id}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={buttonClass}
              disabled={!scorecard}
              onClick={() => download(`scorecard-${activeRun}.json`, JSON.stringify(scorecard, null, 2), "application/json")}
            >
              <Download className="h-3.5 w-3.5" />
              Scorecard (JSON)
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={!state.cases.length}
              onClick={() => download("fraud-cases.csv", casesToCsv(state.cases), "text/csv")}
            >
              <Download className="h-3.5 w-3.5" />
              Cases (CSV)
            </button>
          </div>
          <ScorecardPanel scorecard={scorecard} error={scoreError} loading={scoreLoading} />
        </>
      )}
    </PageShell>
  );
}
