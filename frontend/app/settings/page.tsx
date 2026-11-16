"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { API_BASE, getHealth, getPolicy } from "@/lib/api";
import type { PolicyResponse } from "@/lib/types";
import { useDashboard } from "@/lib/useDashboard";

export default function SettingsPage() {
  const { state, error, refresh } = useDashboard();
  const [health, setHealth] = useState<string>("Checking…");
  const [policy, setPolicy] = useState<PolicyResponse | null>(null);

  useEffect(() => {
    getHealth()
      .then((result) => setHealth(result.message))
      .catch(() => setHealth("Not reachable"));
    getPolicy()
      .then(setPolicy)
      .catch(() => setPolicy(null));
  }, []);

  const rows: Array<[string, string]> = [
    ["Backend URL", API_BASE],
    ["Backend status", health],
    ["Model version", state.cases[0]?.model_version ?? "Shown after the first run"],
    ["Stored runs", String(state.runs.length)],
    ["Customers", String(state.customers.length)],
  ];

  return (
    <PageShell
      eyebrow="Settings"
      title="Environment and active policy"
      description="Read-only view of how this dashboard is connected and which risk policy is active. Policy changes go through the approval flow in the Policy Advisor."
      error={error}
      onRetry={refresh}
    >
      <section className="panel p-5">
        <h2 className="text-xl font-semibold tracking-[-0.02em] text-ink">Connection</h2>
        <dl className="mt-3 text-[13.5px]">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 border-b border-white/[0.04] py-2">
              <dt className="text-mute">{label}</dt>
              <dd className="font-medium text-ink">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[12.5px] text-faint">
          Change the backend URL with NEXT_PUBLIC_FRAUDVERSE_API in frontend/.env.local, then restart the frontend.
        </p>
      </section>

      <section className="panel mt-6 p-5">
        <h2 className="text-xl font-semibold tracking-[-0.02em] text-ink">Active risk policy</h2>
        {policy ? (
          <dl className="mt-3 text-[13.5px]">
            {Object.entries(policy.active).map(([key, value]) => (
              <div key={key} className="flex justify-between gap-4 border-b border-white/[0.04] py-2">
                <dt className="text-mute">{key.replaceAll("_", " ")}</dt>
                <dd className="font-mono font-medium text-ink tabular-nums">
                  {value}
                  {value !== policy.defaults[key as keyof typeof policy.defaults] ? " (changed)" : ""}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-3 text-[13.5px] text-mute">Policy unavailable while the backend is unreachable.</p>
        )}
        <Link href="/advisor" className="mt-4 inline-block text-[13px] text-purple hover:underline">
          Open Policy Advisor →
        </Link>
      </section>
    </PageShell>
  );
}
