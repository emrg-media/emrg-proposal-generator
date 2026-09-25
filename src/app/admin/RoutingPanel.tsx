"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EVENT_TYPES, LEAD_SOURCES } from "@/lib/constants";
import { newRuleId, type RoutingRule, type RoutingSettings, type RuleKind } from "@/lib/routing";
import { saveRoutingAction } from "./actions";

// Rules are read top to bottom and the first match wins, so a specific rule can
// sit above a catch-all. The order on screen is the order they are applied.

const KIND_LABELS: Record<RuleKind, string> = {
  event_type: "Event type is",
  lead_source: "Lead source is",
  value_over: "Worth more than",
  always: "Anything else",
};

export default function RoutingPanel({ settings, team }: {
  settings: RoutingSettings;
  team: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [relationshipWins, setRelationshipWins] = useState(settings.relationshipWins);
  const [fallbackUserId, setFallbackUserId] = useState(settings.fallbackUserId ?? "");
  const [rules, setRules] = useState<RoutingRule[]>(settings.rules);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  function patch(id: string, next: Partial<RoutingRule>) {
    setRules((rs) => rs.map((r) => (r.id === id ? { ...r, ...next } : r)));
  }
  function move(id: string, by: number) {
    setRules((rs) => {
      const i = rs.findIndex((r) => r.id === id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= rs.length) return rs;
      const copy = [...rs];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  }

  function save() {
    setError(""); setSaved(false);
    startTransition(async () => {
      const res = await saveRoutingAction({
        relationshipWins,
        fallbackUserId: fallbackUserId || null,
        rules,
      });
      if (!res.ok) { setError(res.error); return; }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <section className="bg-raised border border-line rounded-lg p-5 mb-5">
      <p className="text-[11px] font-bold tracking-[0.2em] uppercase mb-1" style={{ color: "var(--ink)" }}>
        Who gets the lead
      </p>
      <p className="text-[12.5px] text-ink3 mb-4">
        Read top to bottom, first match wins. Whoever ends up with it is told why on the timeline.
      </p>

      {error && (
        <div className="mb-3 px-3 py-2 rounded border text-[13px]"
          style={{ background: "var(--danger-bg)", borderColor: "var(--danger-line)", color: "var(--danger-ink)" }}>{error}</div>
      )}
      {saved && (
        <div className="mb-3 px-3 py-2 rounded border text-[13px]"
          style={{ background: "var(--good-bg)", borderColor: "var(--good-line)", color: "var(--good-ink)" }}>Saved.</div>
      )}

      <label className="flex items-start gap-2.5 mb-4 cursor-pointer">
        <input type="checkbox" checked={relationshipWins}
          onChange={(e) => setRelationshipWins(e.target.checked)}
          className="mt-0.5 h-[15px] w-[15px] flex-shrink-0" />
        <span className="text-[13.5px] text-ink2">
          <strong>Keep existing clients with the planner who knows them.</strong>{" "}
          <span className="text-ink3">
            Checked before any rule below. Whoever enters the lead is added as a collaborator
            rather than dropped.
          </span>
        </span>
      </label>

      <div className="space-y-2 mb-3">
        {rules.map((r, i) => (
          <div key={r.id} className="flex flex-wrap items-center gap-2 py-2 border-t border-line">
            <span className="text-[11px] text-ink3 tabular-nums w-[18px]">{i + 1}</span>

            <select value={r.kind} disabled={pending}
              onChange={(e) => patch(r.id, { kind: e.target.value as RuleKind, match: "" })}
              className="border-2 border-line-strong rounded-md px-2 py-1.5 text-[12.5px] bg-raised">
              {(Object.keys(KIND_LABELS) as RuleKind[]).map((k) => (
                <option key={k} value={k}>{KIND_LABELS[k]}</option>
              ))}
            </select>

            {r.kind === "event_type" && (
              <select value={r.match ?? ""} onChange={(e) => patch(r.id, { match: e.target.value })}
                className="border-2 border-line-strong rounded-md px-2 py-1.5 text-[12.5px] bg-raised">
                <option value="">Pick one...</option>
                {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
            {r.kind === "lead_source" && (
              <select value={r.match ?? ""} onChange={(e) => patch(r.id, { match: e.target.value })}
                className="border-2 border-line-strong rounded-md px-2 py-1.5 text-[12.5px] bg-raised">
                <option value="">Pick one...</option>
                {LEAD_SOURCES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
            {r.kind === "value_over" && (
              <div className="flex items-center gap-1">
                <span className="text-[13px] text-ink3">$</span>
                <input type="number" min={1}
                  value={r.minValueCents ? r.minValueCents / 100 : ""}
                  onChange={(e) => patch(r.id, { minValueCents: Math.round(Number(e.target.value) * 100) })}
                  className="w-[110px] border-2 border-line-strong rounded-md px-2 py-1.5 text-[12.5px] bg-raised" />
              </div>
            )}

            <span className="text-[12.5px] text-ink3">goes to</span>
            <select value={r.userId} onChange={(e) => patch(r.id, { userId: e.target.value })}
              className="border-2 border-line-strong rounded-md px-2 py-1.5 text-[12.5px] bg-raised">
              <option value="">Pick someone...</option>
              {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>

            <div className="ml-auto flex items-center gap-1">
              <button type="button" onClick={() => move(r.id, -1)} disabled={i === 0}
                className="px-1.5 py-1 text-[12px] text-ink3 disabled:opacity-25" title="Move up">↑</button>
              <button type="button" onClick={() => move(r.id, 1)} disabled={i === rules.length - 1}
                className="px-1.5 py-1 text-[12px] text-ink3 disabled:opacity-25" title="Move down">↓</button>
              <button type="button" onClick={() => patch(r.id, { enabled: !r.enabled })}
                className="text-[10px] font-bold tracking-[0.1em] uppercase px-2 py-1 rounded border"
                style={r.enabled
                  ? { borderColor: "var(--good-line)", color: "var(--good-ink)", background: "var(--good-bg)" }
                  : { borderColor: "var(--line)", color: "var(--ink-3)", background: "var(--raised)" }}>
                {r.enabled ? "On" : "Off"}
              </button>
              <button type="button" onClick={() => setRules((rs) => rs.filter((x) => x.id !== r.id))}
                className="text-[10px] font-bold tracking-[0.1em] uppercase px-2 py-1"
                style={{ color: "var(--accent)" }}>Remove</button>
            </div>
          </div>
        ))}
      </div>

      <button type="button"
        onClick={() => setRules((rs) => [...rs, { id: newRuleId(), kind: "event_type", match: "", userId: "", enabled: true }])}
        className="text-[11px] font-bold tracking-[0.12em] uppercase px-3 py-1.5 rounded border-2 mb-4"
        style={{ borderColor: "var(--line-strong)", color: "var(--ink-2)", background: "var(--raised)" }}>
        Add a rule
      </button>

      <div className="border-t border-line pt-3 mb-4">
        <label className="block text-[10px] font-bold tracking-[0.14em] uppercase text-ink3 mb-1.5">
          When nothing matches and nobody entered it by hand
        </label>
        <select value={fallbackUserId} onChange={(e) => setFallbackUserId(e.target.value)}
          className="border-2 border-line-strong rounded-md px-3 py-2 text-[14px] bg-raised">
          <option value="">Give it to whoever has the fewest open opportunities</option>
          {team.map((m) => <option key={m.id} value={m.id}>Always {m.name}</option>)}
        </select>
      </div>

      <button type="button" disabled={pending} onClick={save}
        className="text-[10px] font-bold tracking-[0.14em] uppercase px-4 py-2 rounded"
        
style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>
        {pending ? "Saving..." : "Save routing"}
      </button>
    </section>
  );
}
