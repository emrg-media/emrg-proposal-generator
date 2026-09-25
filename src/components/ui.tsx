import Link from "next/link";
import type { ReactNode } from "react";
import { stageStyle, readableInk } from "@/lib/colors";

// Small shared presentation pieces, so the screens stay readable and every
// page renders a stage chip or a money figure the same way.

export function StatCard({ label, value, accent, sub, trend }: {
  label: string; value: string; accent?: "red" | "green" | "amber"; sub?: string;
  /** Optional 0..1 share, drawn as a bar under the figure. */
  trend?: number;
}) {
  const color = accent === "green" ? "var(--good)"
    : accent === "red" ? "var(--accent)"
    : accent === "amber" ? "var(--warn)"
    : "var(--ink)";

  return (
    <div className="bg-raised border border-line rounded-lg px-5 py-4 flex flex-col gap-1.5">
      <p className="text-[10.5px] font-bold tracking-[0.16em] uppercase text-ink2">{label}</p>
      <p className="text-[30px] font-bold leading-none tracking-tight"
        style={{ color, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </p>
      {typeof trend === "number" && (
        <div className="h-[4px] rounded-full overflow-hidden mt-0.5" style={{ background: "var(--sunken)" }}>
          <div className="h-full rounded-full transition-[width] duration-500"
            style={{ width: `${Math.max(0, Math.min(1, trend)) * 100}%`, background: color }} />
        </div>
      )}
      {sub && <p className="text-[11.5px] text-ink3 leading-snug">{sub}</p>}
    </div>
  );
}

export function StageChip({ stage, label }: { stage: string; label: string }) {
  const c = stageStyle(stage);
  return (
    <span
      className="inline-block px-2 py-0.5 rounded text-[10px] font-bold tracking-[0.08em] uppercase whitespace-nowrap border"
      style={{ background: c.bg, color: c.fg, borderColor: c.border }}
    >
      {label}
    </span>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-bold tracking-[0.22em] uppercase mb-3" style={{ color: "var(--ink)" }}>
      {children}
    </p>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="bg-raised border border-line rounded-lg px-6 py-14 text-center">
      <p className="text-[15px] font-medium text-ink2">{title}</p>
      {hint && <p className="text-[13px] text-ink3 mt-1.5">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function OppLink({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return <Link href={`/opportunity/${id}`} className={className}>{children}</Link>;
}

/** Owner initials in that person's colour, always beside their name. */
export function OwnerBadge({ name, color }: { name: string | null; color?: string | null }) {
  if (!name) {
    return (
      <span className="text-[11px] font-semibold px-2 py-0.5 rounded"
        style={{ background: "var(--danger-bg)", color: "var(--danger-ink)" }}>
        Unassigned
      </span>
    );
  }
  const initials = name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const fill = color ?? "var(--ink-2)";
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span
        className="inline-flex items-center justify-center w-[22px] h-[22px] rounded-full text-[9.5px] font-bold flex-shrink-0"
        style={{ background: fill, color: readableInk(fill) }}
      >
        {initials}
      </span>
      <span className="text-[12.5px] text-ink2">{name.split(" ")[0]}</span>
    </span>
  );
}
