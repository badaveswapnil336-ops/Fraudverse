"use client";

import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { Sidebar } from "@/components/Sidebar";

interface PageShellProps {
  eyebrow: string;
  title: string;
  description: string;
  error?: string | null;
  onRetry?: () => void;
  children: ReactNode;
}

/** Common layout for every sidebar page: sidebar, heading and a backend-error banner. */
export function PageShell({ eyebrow, title, description, error, onRetry, children }: PageShellProps) {
  return (
    <div className="relative z-10 flex min-h-screen gap-4 p-4">
      <Sidebar />
      <main className="min-w-0 flex-1 pb-10">
        <header className="px-1 pt-4">
          <span className="font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-purple">
            {eyebrow}
          </span>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.02em] text-ink">{title}</h1>
          <p className="mt-2 max-w-[760px] text-[14px] leading-6 text-mute">{description}</p>
        </header>

        {error ? (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[#fbbf24]/30 bg-[#fbbf24]/[0.06] px-4 py-3 text-[13px] text-[#fbbf24]">
            <span>{error}</span>
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-2 rounded border border-white/[0.09] bg-white/[0.03] px-3 py-1.5 text-mute transition hover:text-ink"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Retry
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="mt-6">{children}</div>
      </main>
    </div>
  );
}
