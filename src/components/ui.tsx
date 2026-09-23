import Link from "next/link";
import type { ReactNode } from "react";
import { stageStyle, readableInk } from "@/lib/colors";

// Small shared presentation pieces, so the screens stay readable and every
// page renders a stage chip or a money figure the same way.

export function StatCard({ label, value, accent, sub }: {
  label: string; value: string; accent?: "red" | "green" | "amber"; sub?: string;
}) {
  const color = accent === "green" ? "#15803d"
    : accent === "red" ? "var(--emrg-red)"
    : accent === "amber" ? "#92600a"
    : "#111111";
  return (
    <div className="bg-white border border-stone-200 rounded-lg px-5 py-4">
      <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-stone-500 mb-1.5">{label}</p>
      <p className="text-[28px] font-bold leading-none" style={{ color, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </p>
      {sub && <p className="text-[11px] text-stone-400 mt-1.5">{sub}</p>}
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
    <p className="text-[11px] font-bold tracking-[0.22em] uppercase mb-3" style={{ color: "#111111" }}>
      {children}
    </p>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="bg-white border border-stone-200 rounded-lg px-6 py-14 text-center">
      <p className="text-[15px] font-medium text-stone-700">{title}</p>
      {hint && <p className="text-[13px] text-stone-400 mt-1.5">{hint}</p>}
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
        style={{ background: "rgba(192,24,42,0.08)", color: "var(--emrg-red)" }}>
        Unassigned
      </span>
    );
  }
  const initials = name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const fill = color ?? "#57534e";
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span
        className="inline-flex items-center justify-center w-[22px] h-[22px] rounded-full text-[9.5px] font-bold flex-shrink-0"
        style={{ background: fill, color: readableInk(fill) }}
      >
        {initials}
      </span>
      <span className="text-[12.5px] text-stone-600">{name.split(" ")[0]}</span>
    </span>
  );
}
