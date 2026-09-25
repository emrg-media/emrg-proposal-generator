"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ROLE_LABELS } from "@/lib/constants";
import type { UserRole } from "@/db/schema";
import {
  createUserAction, resetPinAction, setUserActiveAction, setRoleAction, saveSettingsAction,
  type AdminResult,
} from "./actions";

interface Member {
  id: string; name: string; email: string; role: string; active: boolean; locked: boolean;
}

export default function AdminPanel({ currentUserId, team, settings }: {
  currentUserId: string;
  team: Member[];
  settings: { responseTargetMinutes: number; followupCadenceDays: number[] };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  // A freshly generated PIN is shown once, right here, and never again.
  const [revealed, setRevealed] = useState<{ name: string; pin: string } | null>(null);

  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("planner");

  const [target, setTarget] = useState(String(settings.responseTargetMinutes));
  const [cadence, setCadence] = useState(settings.followupCadenceDays.join(", "));
  const [saved, setSaved] = useState(false);

  function run(fn: () => Promise<AdminResult>, who?: string) {
    setError(""); setSaved(false);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) { setError(res.error); return; }
      if (res.pin && who) setRevealed({ name: who, pin: res.pin });
      else setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="px-5 md:px-8 py-6 max-w-[1000px] mx-auto">
      <h1 className="text-[22px] font-bold tracking-tight mb-1" style={{ color: "var(--ink)" }}>Admin</h1>
      <p className="text-[13px] text-ink3 mb-6">The team, their PINs, and how the system behaves.</p>

      {error && <Banner tone="red">{error}</Banner>}
      {saved && <Banner tone="green">Saved.</Banner>}

      {revealed && (
        <div className="mb-5 px-4 py-3.5 rounded-lg border"
          style={{ background: "var(--warn-bg)", borderColor: "var(--warn-line)" }}>
          <p className="text-[12.5px] font-bold tracking-[0.06em] uppercase mb-1" style={{ color: "var(--warn-ink)" }}>
            {revealed.name}&apos;s PIN (shown once)
          </p>
          <p className="text-[28px] font-bold tracking-[0.3em] tabular-nums mb-1" style={{ color: "var(--warn-ink)" }}>
            {revealed.pin}
          </p>
          <p className="text-[12.5px] mb-2" style={{ color: "var(--warn-ink)" }}>
            Only the hash is stored, so this can&apos;t be looked up later. Pass it on now.
          </p>
          <button type="button" onClick={() => setRevealed(null)}
            className="text-[11px] font-bold tracking-[0.12em] uppercase px-3 py-1.5 rounded border"
            style={{ borderColor: "var(--warn-line)", color: "var(--warn-ink)", background: "var(--raised)" }}>
            Got it
          </button>
        </div>
      )}

      {/* ── Team ── */}
      <section className="bg-raised border border-line rounded-lg p-5 mb-5">
        <p className="text-[11px] font-bold tracking-[0.2em] uppercase mb-4" style={{ color: "var(--ink)" }}>
          Team
        </p>
        <div className="space-y-2">
          {team.map((m) => (
            <div key={m.id}
              className="flex flex-wrap items-center gap-3 py-2.5 border-b border-line last:border-0"
              style={{ opacity: m.active ? 1 : 0.5 }}>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium text-ink truncate">
                  {m.name}
                  {m.id === currentUserId && <span className="text-[11px] text-ink3 ml-2">(you)</span>}
                  {m.locked && (
                    <span className="text-[10px] font-bold uppercase tracking-[0.1em] ml-2 px-1.5 py-0.5 rounded"
                      style={{ background: "var(--danger-bg)", color: "var(--danger-ink)" }}>
                      Locked out
                    </span>
                  )}
                </p>
                <p className="text-[12px] text-ink3 truncate">{m.email}</p>
              </div>

              <select value={m.role} disabled={pending}
                onChange={(e) => run(() => setRoleAction(m.id, e.target.value))}
                className="border-2 border-line-strong rounded-md px-2.5 py-1.5 text-[12.5px] bg-raised">
                {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>

              <button type="button" disabled={pending}
                onClick={() => run(() => resetPinAction(m.id), m.name)}
                className="text-[10px] font-bold tracking-[0.12em] uppercase px-3 py-1.5 rounded border-2"
                style={{ borderColor: "var(--line-strong)", color: "var(--ink-2)", background: "var(--raised)" }}>
                {m.locked ? "Reset PIN & unlock" : "Reset PIN"}
              </button>

              <button type="button" disabled={pending || m.id === currentUserId}
                onClick={() => run(() => setUserActiveAction(m.id, !m.active))}
                className="text-[10px] font-bold tracking-[0.12em] uppercase px-3 py-1.5 rounded border-2 disabled:opacity-30"
                style={{ borderColor: "var(--line-strong)", color: m.active ? "var(--accent)" : "var(--good)", background: "var(--raised)" }}>
                {m.active ? "Deactivate" : "Reactivate"}
              </button>
            </div>
          ))}
        </div>

        <div className="border-t border-line mt-4 pt-4">
          <p className="text-[10px] font-bold tracking-[0.14em] uppercase text-ink3 mb-2">Add someone</p>
          <div className="flex flex-wrap gap-2">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name"
              className="flex-1 min-w-[130px] border-2 border-line-strong rounded-md px-3 py-2 text-[14px] bg-raised" />
            <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="name@emrgmedia.com"
              className="flex-1 min-w-[180px] border-2 border-line-strong rounded-md px-3 py-2 text-[14px] bg-raised" />
            <select value={newRole} onChange={(e) => setNewRole(e.target.value as UserRole)}
              className="border-2 border-line-strong rounded-md px-2.5 py-2 text-[13px] bg-raised">
              {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
            <button type="button" disabled={pending || !newName.trim() || !newEmail.trim()}
              onClick={() => {
                const name = newName.trim();
                run(() => createUserAction(name, newEmail, newRole), name);
                setNewName(""); setNewEmail("");
              }}
              className="text-[10px] font-bold tracking-[0.14em] uppercase px-4 py-2 rounded  disabled:opacity-40"
              
style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>
              Add
            </button>
          </div>
        </div>
      </section>

      {/* ── Settings ── */}
      <section className="bg-raised border border-line rounded-lg p-5 mb-10">
        <p className="text-[11px] font-bold tracking-[0.2em] uppercase mb-4" style={{ color: "var(--ink)" }}>
          How the system behaves
        </p>
        <div className="grid sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-[10px] font-bold tracking-[0.14em] uppercase text-ink3 mb-1.5">
              Response target (minutes)
            </label>
            <input type="number" min={1} value={target} onChange={(e) => setTarget(e.target.value)}
              className="w-full border-2 border-line-strong rounded-md px-3 py-2 text-[14px] bg-raised" />
            <p className="text-[11.5px] text-ink3 mt-1">
              A lead unanswered for longer than this is flagged as overdue.
            </p>
          </div>
          <div>
            <label className="block text-[10px] font-bold tracking-[0.14em] uppercase text-ink3 mb-1.5">
              Follow-up cadence (days)
            </label>
            <input value={cadence} onChange={(e) => setCadence(e.target.value)} placeholder="1, 3, 7"
              className="w-full border-2 border-line-strong rounded-md px-3 py-2 text-[14px] bg-raised" />
            <p className="text-[11.5px] text-ink3 mt-1">
              Days after a proposal is sent. A live conversation always pauses it.
            </p>
          </div>
        </div>
        <button type="button" disabled={pending}
          onClick={() => run(() => saveSettingsAction(parseInt(target, 10), cadence))}
          className="text-[10px] font-bold tracking-[0.14em] uppercase px-4 py-2 rounded"
          
style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>
          Save settings
        </button>
      </section>
    </div>
  );
}

function Banner({ tone, children }: { tone: "red" | "green"; children: React.ReactNode }) {
  const s = tone === "red"
    ? { background: "var(--danger-bg)", border: "var(--danger-line)", color: "var(--danger-ink)" }
    : { background: "var(--good-bg)", border: "var(--good-line)", color: "var(--good-ink)" };
  return (
    <div className="mb-4 px-4 py-2.5 rounded-lg border text-[13px]"
      style={{ background: s.background, borderColor: s.border, color: s.color }}>
      {children}
    </div>
  );
}
