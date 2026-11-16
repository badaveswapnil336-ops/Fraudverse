"use client";

import { RotateCcw } from "lucide-react";
import { formatParam, paramLabel } from "@/lib/advisorUtils";
import type { PolicyResponse, PolicyValues } from "@/lib/types";

interface PolicyCardProps {
  policy: PolicyResponse | null;
  busy: boolean;
  onReset: () => void;
}

const order: Array<keyof PolicyValues> = [
  "supervised_weight",
  "monitor_threshold",
  "verify_threshold",
  "block_threshold",
  "critical_threshold",
];

export function PolicyCard({ policy, busy, onReset }: PolicyCardProps) {
  const changed = policy ? order.filter((key) => policy.active[key] !== policy.defaults[key]) : [];

  return (
    <article className="panel p-5" data-testid="policy-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-purple">
            Active risk policy
          </span>
          <h2 className="mt-2 text-xl font-semibold tracking-[-0.02em] text-ink">
            How scores become decisions
          </h2>
        </div>
        {changed.length ? (
          <button
            type="button"
            disabled={busy}
            onClick={onReset}
            className="inline-flex items-center gap-2 rounded border border-white/[0.09] bg-white/[0.03] px-3 py-1.5 text-[13px] text-mute transition hover:bg-white/[0.06] hover:text-ink disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset to defaults
          </button>
        ) : null}
      </div>

      {policy ? (
        <>
          <dl className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            {order.map((key) => {
              const differs = policy.active[key] !== policy.defaults[key];
              return (
                <div
                  key={key}
                  title={policy.doc[key]}
                  className={`rounded-[10px] border px-3 py-2.5 ${
                    differs ? "border-purple/40 bg-purple/[0.08]" : "border-white/[0.06]"
                  }`}
                >
                  <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-dim">
                    {paramLabel(key)}
                  </dt>
                  <dd className="mt-1 font-mono text-[18px] font-semibold text-ink" data-testid={`policy-${key}`}>
                    {formatParam(key, policy.active[key])}
                  </dd>
                  {differs ? (
                    <div className="font-mono text-[11px] text-faint">
                      default {formatParam(key, policy.defaults[key])}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </dl>
          <p className="mt-3 text-[12.5px] leading-5 text-faint">
            A payment is challenged from the verify score and declined from the block score. A change
            applies to new runs; runs already scored keep their original decisions.
          </p>
        </>
      ) : (
        <p className="mt-4 text-[14px] text-mute">Policy not loaded.</p>
      )}
    </article>
  );
}
