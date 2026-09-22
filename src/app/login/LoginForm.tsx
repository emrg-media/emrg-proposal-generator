"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

// Two taps and six digits. The name is remembered per browser so the usual
// case is: open the app, type your PIN, you're in.

interface Member { id: string; name: string }

// The remembered name never changes mid-session, so there is nothing to subscribe to.
function subscribeNever() { return () => {}; }

export default function LoginForm({ team }: { team: Member[] }) {
  const [picked, setPicked] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const pinRef = useRef<HTMLInputElement>(null);

  // Remember who last used this browser — most people use the same device.
  // Read through useSyncExternalStore rather than an effect: it gives the
  // server an explicit empty snapshot, so there is no hydration mismatch and
  // no cascading render from setting state during an effect.
  const remembered = useSyncExternalStore(
    subscribeNever,
    () => { try { return localStorage.getItem("emrg_user_id") ?? ""; } catch { return ""; } },
    () => "",
  );
  const userId = picked || (team.some((m) => m.id === remembered) ? remembered : "");

  useEffect(() => {
    if (userId) pinRef.current?.focus();
  }, [userId]);

  async function submit(id: string, code: string) {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: id, pin: code }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Login failed");

      localStorage.setItem("emrg_user_id", id);
      const from = new URLSearchParams(window.location.search).get("from");
      // Only ever follow a same-site path, never an absolute URL.
      window.location.href = from && /^\/(?!\/)/.test(from) ? from : "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setPin("");
      setLoading(false);
      pinRef.current?.focus();
    }
  }

  function onPinChange(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 6);
    setPin(digits);
    setError("");
    // Submit as soon as the PIN is complete — no extra tap needed.
    if (digits.length === 6 && userId) submit(userId, digits);
  }

  const selected = team.find((m) => m.id === userId);

  return (
    <div className="bg-white border border-stone-200 rounded-lg p-7 shadow-sm">
      <label className="block text-[11px] font-bold tracking-[0.22em] uppercase mb-3" style={{ color: "#111111" }}>
        Who are you?
      </label>

      <div className="grid grid-cols-2 gap-2 mb-6">
        {team.map((m) => {
          const active = m.id === userId;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => { setPicked(m.id); setPin(""); setError(""); }}
              className="px-3 py-2.5 rounded-md text-[13px] font-medium border-2 transition-colors text-left truncate"
              style={active
                ? { borderColor: "var(--emrg-red)", background: "rgba(192,24,42,0.04)", color: "#111111" }
                : { borderColor: "#d6d3d1", background: "#fff", color: "#57534e" }}
            >
              {m.name}
            </button>
          );
        })}
      </div>

      <label
        className="block text-[11px] font-bold tracking-[0.22em] uppercase mb-2"
        style={{ color: userId ? "#111111" : "#a8a29e" }}
      >
        {selected ? `${selected.name.split(" ")[0]}'s PIN` : "Your PIN"}
      </label>
      <input
        ref={pinRef}
        type="password"
        inputMode="numeric"
        autoComplete="one-time-code"
        value={pin}
        disabled={!userId || loading}
        onChange={(e) => onPinChange(e.target.value)}
        placeholder={userId ? "6 digits" : "Pick your name first"}
        className="w-full border-2 border-stone-400 rounded-md px-4 py-3 text-[20px] tracking-[0.5em] text-center bg-white text-stone-900 placeholder:text-[14px] placeholder:tracking-normal placeholder-stone-400 disabled:bg-stone-50 disabled:border-stone-200"
      />

      {error && <p className="text-[13px] font-semibold mt-3" style={{ color: "var(--emrg-red)" }}>{error}</p>}
      {loading && <p className="text-[13px] text-stone-500 mt-3">Checking…</p>}

      <p className="text-[11.5px] text-stone-400 mt-4 leading-relaxed">
        Forgotten your PIN? Ask Mario or Erica to reset it from the admin screen.
      </p>
    </div>
  );
}
