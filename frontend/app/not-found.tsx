import Link from "next/link";

export default function NotFound() {
  return (
    <div className="relative z-10 grid min-h-screen place-items-center p-6">
      <div className="panel max-w-[520px] p-8 text-center">
        <div className="font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-purple">404</div>
        <h1 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-ink">Page not found</h1>
        <p className="mt-3 text-[14px] leading-6 text-mute">There is nothing at this address.</p>
        <Link
          href="/"
          className="mt-5 inline-block rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-bg transition hover:bg-[#e6e8ea]"
        >
          Back to Overview
        </Link>
      </div>
    </div>
  );
}
