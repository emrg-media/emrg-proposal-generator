"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { STAGES, STAGE_LABELS } from "@/lib/constants";
import { fmtCents } from "@/lib/fee";
import { formatDuration } from "@/lib/time";
import { changeStageAction } from "@/app/actions";
import type { Stage } from "@/db/schema";

// Nine columns, drag to move. Moves apply optimistically so the board never
// feels like it is waiting on the network; if the write fails the card snaps
// back and the error is shown rather than silently swallowed.

export interface BoardCard {
  id: string; company: string; contact: string; eventName: string; eventDate: string;
  valueCents: number | null; valueEstimated: boolean; feeRaw: string;
  stage: Stage; ownerName: string | null; collaboratorNames: string[];
  leadAgeMs: number; lastActivityMs: number;
  nextAction: string; nextActionOverdue: boolean;
  followupState: string; approvalWaiting: boolean;
  responseStatus: "answered" | "within" | "approaching" | "overdue";
}

export default function PipelineBoard({ cards }: { cards: BoardCard[] }) {
  const router = useRouter();
  const [local, setLocal] = useState(cards);
  const [dragId, setDragId] = useState("");
  const [overStage, setOverStage] = useState("");
  const [error, setError] = useState("");

  // Keep in step when the server sends fresh data (e.g. after router.refresh).
  const [seed, setSeed] = useState(cards);
  if (seed !== cards) { setSeed(cards); setLocal(cards); }

  async function drop(stage: Stage) {
    const id = dragId;
    setDragId(""); setOverStage("");
    const card = local.find((c) => c.id === id);
    if (!card || card.stage === stage) return;

    const before = local;
    setLocal((cs) => cs.map((c) => (c.id === id ? { ...c, stage } : c)));
    setError("");

    const res = await changeStageAction(id, stage);
    if (!res.ok) {
      setLocal(before); // snap back
      setError(res.error);
    } else {
      router.refresh();
    }
  }

  return (
    <div className="px-5 md:px-8 py-6 max-w-[1600px] mx-auto">
      <div className="flex items-end justify-between gap-4 mb-5">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight" style={{ color: "#111111" }}>Pipeline</h1>
          <p className="text-[13px] text-stone-500 mt-1">
            {local.length} opportunit{local.length === 1 ? "y" : "ies"} · drag a card to move it
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-2.5 rounded-lg border text-[13px]"
          style={{ background: "#fef2f2", borderColor: "#fecaca", color: "#991b1b" }}>
          {error}
        </div>
      )}

      <div className="flex gap-3 overflow-x-auto pb-4">
        {STAGES.map((stage) => {
          const column = local.filter((c) => c.stage === stage);
          const total = column.reduce((s, c) => s + (c.valueCents ?? 0), 0);
          const isOver = overStage === stage;
          return (
            <div
              key={stage}
              onDragOver={(e) => { e.preventDefault(); setOverStage(stage); }}
              onDragLeave={() => setOverStage((s) => (s === stage ? "" : s))}
              onDrop={(e) => { e.preventDefault(); drop(stage); }}
              className="flex-shrink-0 w-[248px] rounded-lg transition-colors"
              style={{ background: isOver ? "rgba(192,24,42,0.05)" : "transparent" }}
            >
              <div className="px-2 pb-2 sticky top-0">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[10.5px] font-bold tracking-[0.12em] uppercase text-stone-600 truncate">
                    {STAGE_LABELS[stage]}
                  </p>
                  <span className="text-[11px] text-stone-400 tabular-nums">{column.length}</span>
                </div>
                <p className="text-[11.5px] text-stone-400 tabular-nums">
                  {total > 0 ? fmtCents(total) : "—"}
                </p>
              </div>

              <div className="space-y-2 min-h-[80px]">
                {column.map((card) => (
                  <Card key={card.id} card={card}
                    dragging={dragId === card.id}
                    onDragStart={() => setDragId(card.id)}
                    onDragEnd={() => { setDragId(""); setOverStage(""); }} />
                ))}
                {column.length === 0 && (
                  <div className="border border-dashed border-stone-300 rounded-lg h-[72px] flex items-center justify-center">
                    <span className="text-[11.5px] text-stone-300">Drop here</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Card({ card, dragging, onDragStart, onDragEnd }: {
  card: BoardCard; dragging: boolean; onDragStart: () => void; onDragEnd: () => void;
}) {
  const late = card.responseStatus === "overdue";
  const approaching = card.responseStatus === "approaching";

  return (
    <Link
      href={`/opportunity/${card.id}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className="block bg-white border border-stone-200 rounded-lg px-3 py-2.5 hover:border-stone-300 transition-all cursor-grab active:cursor-grabbing"
      style={{ opacity: dragging ? 0.4 : 1 }}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <p className="text-[13.5px] font-semibold text-stone-900 leading-tight truncate">
          {card.company || card.contact || "Untitled"}
        </p>
        <span className="text-[12.5px] font-semibold text-stone-700 whitespace-nowrap tabular-nums">
          {card.valueCents ? (card.valueEstimated ? "≈ " : "") + fmtCents(card.valueCents) : ""}
        </span>
      </div>

      {(card.eventName || card.eventDate) && (
        <p className="text-[11.5px] text-stone-500 truncate mb-1.5">
          {[card.eventName, card.eventDate].filter(Boolean).join(" · ")}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1 mb-1.5">
        {card.approvalWaiting && <Tag tone="orange">Waiting for Erica</Tag>}
        {late && <Tag tone="red">Unanswered {formatDuration(card.leadAgeMs)}</Tag>}
        {approaching && <Tag tone="amber">Answer soon</Tag>}
        {card.nextActionOverdue && <Tag tone="amber">Action overdue</Tag>}
        {card.followupState === "paused" && <Tag tone="grey">Follow-up paused</Tag>}
        {!card.nextAction.trim() && !card.nextActionOverdue && <Tag tone="grey">No next action</Tag>}
      </div>

      <div className="flex items-center justify-between gap-2 text-[11px] text-stone-400">
        <span className="truncate">
          {card.ownerName ?? <span style={{ color: "var(--emrg-red)" }}>Unassigned</span>}
          {card.collaboratorNames.length > 0 && ` +${card.collaboratorNames.length}`}
        </span>
        <span className="whitespace-nowrap">{formatDuration(card.lastActivityMs)} ago</span>
      </div>
    </Link>
  );
}

function Tag({ tone, children }: { tone: "red" | "amber" | "orange" | "grey"; children: React.ReactNode }) {
  const s = tone === "red" ? { bg: "rgba(192,24,42,0.08)", fg: "var(--emrg-red)" }
    : tone === "amber" ? { bg: "#fdf6e9", fg: "#92600a" }
    : tone === "orange" ? { bg: "#fff7ed", fg: "#9a3412" }
    : { bg: "#f5f5f4", fg: "#78716c" };
  return (
    <span className="px-1.5 py-0.5 rounded text-[9.5px] font-bold tracking-[0.04em] uppercase whitespace-nowrap"
      style={{ background: s.bg, color: s.fg }}>
      {children}
    </span>
  );
}
