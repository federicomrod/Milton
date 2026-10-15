// A short, friendly empty state for a brand-new account: what is missing and
// the way to start. Never a number (no $0, no made-up amount). Server-safe.

import Link from "next/link";

export interface EmptyAction {
  href: string;
  label: string;
  primary?: boolean;
}

export function EmptyState({
  text,
  actions = [],
  testId = "empty-state",
}: {
  text: string;
  actions?: EmptyAction[];
  testId?: string;
}) {
  return (
    <section
      data-testid={testId}
      className="rounded-[14px] border border-[#c6d3f5] bg-[#eef2fd] px-4 py-3.5"
    >
      <p className="text-[13px] text-[#26314a]">{text}</p>
      {actions.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {actions.map((a) => (
            <Link
              key={a.href + a.label}
              href={a.href}
              className={
                a.primary
                  ? "inline-block rounded-lg bg-[#1b40c8] px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-[#1535a6]"
                  : "inline-block rounded-lg border border-[#c6d3f5] bg-white px-3.5 py-2 text-[13px] font-semibold text-[#1b40c8] hover:bg-[#eef2fd]"
              }
            >
              {a.label}
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}
