import Link from "next/link";

interface EmptyStateProps {
  title: string;
  hint: string;
  actionLabel?: string;
  actionHref?: string;
}

export function EmptyState({ title, hint, actionLabel, actionHref }: EmptyStateProps) {
  return (
    <div className="panel p-8 text-center">
      <div className="text-[15px] font-semibold text-ink">{title}</div>
      <p className="mx-auto mt-2 max-w-[520px] text-[13.5px] leading-6 text-mute">{hint}</p>
      {actionLabel && actionHref ? (
        <Link
          href={actionHref}
          className="mt-4 inline-block rounded-lg bg-ink px-4 py-2 text-sm font-medium text-bg transition hover:bg-[#e6e8ea]"
        >
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}
