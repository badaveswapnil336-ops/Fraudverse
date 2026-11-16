"use client";

import { useMemo, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import type { FraudCase, Transaction } from "@/lib/types";

interface InvestigatorViewProps {
  cases: FraudCase[];
  transactions: Transaction[];
}

const features: Array<[keyof Transaction, string]> = [
  ["amount", "Amount"],
  ["amount_ratio", "Amount vs customer average"],
  ["velocity_10m", "Payments in last 10 min"],
  ["velocity_24h", "Payments in last 24 h"],
  ["beneficiary_age_minutes", "Payee age (minutes)"],
  ["device_trust_score", "Device trust"],
  ["geo_distance_km", "Distance from home (km)"],
  ["is_new_device", "New device"],
  ["is_new_beneficiary", "New payee"],
  ["channel", "Channel"],
  ["authentication_method", "Authentication"],
];

/** One flagged case at a time: the stored explanation next to the real transaction features. */
export function InvestigatorView({ cases, transactions }: InvestigatorViewProps) {
  const flagged = useMemo(
    () => cases.filter((item) => item.decision === "VERIFY" || item.decision === "BLOCK"),
    [cases],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = flagged.find((item) => item.case_id === selectedId) ?? flagged[0];
  const transaction = useMemo(
    () => transactions.find((item) => item.transaction_id === selected?.transaction_id),
    [transactions, selected],
  );

  if (!flagged.length) {
    return (
      <EmptyState
        title="No flagged cases to investigate"
        hint="Cases appear when a payment is challenged (VERIFY) or blocked. Launch an attack first."
        actionLabel="Open Attack Lab"
        actionHref="/attack-lab"
      />
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
      <div className="panel max-h-[620px] overflow-auto p-2">
        {flagged.map((item) => (
          <button
            key={item.case_id}
            type="button"
            onClick={() => setSelectedId(item.case_id)}
            className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left text-[13.5px] transition ${
              item.case_id === selected?.case_id
                ? "bg-white/[0.07] text-ink"
                : "text-mute hover:bg-white/[0.04] hover:text-ink"
            }`}
          >
            <span className="font-semibold">{item.transaction_id}</span>
            <span className="font-mono text-[12px] tabular-nums">
              {item.decision} · {Math.round(item.risk_score * 100)}
            </span>
          </button>
        ))}
      </div>

      {selected ? (
        <div className="grid gap-4">
          <article className="panel p-5">
            <span className="font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-purple">
              {selected.case_id} · {selected.decision} · {selected.risk_level}
            </span>
            <p className="mt-3 text-[14px] leading-6 text-mute">{selected.explanation}</p>
            <p className="mt-3 text-[13px] text-faint">Recommended action: {selected.action}</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {[
                ["Model score", selected.xgboost_score],
                ["Anomaly score", selected.anomaly_score],
                ["Fused risk", selected.risk_score],
              ].map(([label, value]) => (
                <div key={label as string} className="card p-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-dim">{label}</div>
                  <div className="mt-1 font-mono text-xl font-semibold text-ink tabular-nums">
                    {(value as number).toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="panel p-5">
            <h2 className="text-[15px] font-semibold text-ink">Why it was flagged</h2>
            <div className="mt-3 grid gap-2">
              {selected.top_risk_factors.map((factor) => (
                <div key={factor.feature} className="card p-3">
                  <div className="flex justify-between gap-2 text-[13.5px]">
                    <span className="font-semibold text-ink">{factor.feature}</span>
                    <span className="font-medium text-mute tabular-nums">{String(factor.value)}</span>
                  </div>
                  <p className="mt-1 text-[13px] leading-5 text-faint">{factor.reason}</p>
                </div>
              ))}
            </div>
          </article>

          <article className="panel p-5">
            <h2 className="text-[15px] font-semibold text-ink">Transaction details</h2>
            {transaction ? (
              <dl className="mt-3 grid gap-x-6 gap-y-2 text-[13.5px] sm:grid-cols-2">
                {features.map(([key, label]) => (
                  <div key={key} className="flex justify-between gap-3 border-b border-white/[0.04] py-1.5">
                    <dt className="text-mute">{label}</dt>
                    <dd className="font-medium text-ink tabular-nums">{String(transaction[key] ?? "--")}</dd>
                  </div>
                ))}
                <div className="flex justify-between gap-3 border-b border-white/[0.04] py-1.5 sm:col-span-2">
                  <dt className="text-mute">Ground truth (synthetic label)</dt>
                  <dd className="font-medium text-ink">
                    {transaction.label === 1 ? `Fraud (${transaction.attack_type ?? "unlabelled"})` : "Genuine"}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="mt-3 text-[13.5px] text-faint">
                Transaction details are not loaded for this case. Refresh the page.
              </p>
            )}
          </article>
        </div>
      ) : null}
    </div>
  );
}
