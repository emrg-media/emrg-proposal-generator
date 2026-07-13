"use client";

import { useState } from "react";

export default function LoginPage() {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!passcode.trim() || loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Login failed");
      }
      const from = new URLSearchParams(window.location.search).get("from");
      window.location.href = from && from.startsWith("/") ? from : "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#f5f4f2" }}>
      <div style={{ height: 4, background: "var(--emrg-red)" }} />
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <div className="flex items-baseline gap-2 justify-center mb-8">
            <span className="text-2xl font-bold tracking-tight" style={{ color: "#111111" }}>EMRG</span>
            <span className="text-2xl font-light tracking-[0.18em] text-stone-400">MEDIA</span>
          </div>
          <form onSubmit={submit} className="bg-white border border-stone-200 rounded-lg p-7 shadow-sm">
            <label className="block text-[11px] font-bold tracking-[0.22em] uppercase mb-2" style={{ color: "#111111" }}>
              Team Passcode
            </label>
            <input
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              autoFocus
              placeholder="Enter passcode"
              className="w-full border-2 border-stone-400 rounded-md px-4 py-2.5 text-[16px] bg-white text-stone-900 placeholder-stone-400"
            />
            {error && <p className="text-[13px] font-semibold mt-2" style={{ color: "var(--emrg-red)" }}>{error}</p>}
            <button
              type="submit"
              disabled={loading || !passcode.trim()}
              className="w-full mt-4 py-3 text-[13px] font-bold tracking-[0.2em] uppercase rounded-md text-white transition-opacity disabled:opacity-40"
              style={{ background: "var(--emrg-red)" }}
            >
              {loading ? "Checking…" : "Enter"}
            </button>
          </form>
          <p className="text-[12px] text-stone-400 text-center mt-4">EMRG Media proposal tools</p>
        </div>
      </div>
    </div>
  );
}
