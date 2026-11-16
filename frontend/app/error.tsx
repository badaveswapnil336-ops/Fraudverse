"use client";

// Shown if a page throws while rendering, instead of a blank screen.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="relative z-10 grid min-h-screen place-items-center p-6">
      <div className="panel max-w-[520px] p-8 text-center" role="alert">
        <div className="font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-[#fbbf24]">
          Something went wrong
        </div>
        <h1 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-ink">This page could not be shown</h1>
        <p className="mt-3 text-[14px] leading-6 text-mute">
          {error.message || "An unexpected error occurred."} Your data is safe: it is stored by the backend.
        </p>
        <div className="mt-5 flex justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-bg transition hover:bg-[#e6e8ea]"
          >
            Try again
          </button>
          <a
            href="/"
            className="rounded-lg border border-white/[0.09] bg-white/[0.03] px-4 py-2.5 text-sm text-mute transition hover:text-ink"
          >
            Back to Overview
          </a>
        </div>
      </div>
    </div>
  );
}
