"use client";

import { useEffect, useState } from "react";
import presetData from "@/data/invoice-presets.json";
import {
  computeInvoice, fmtMoney, DEFAULT_TAX_RATE,
  type InvoiceData, type InvoiceLineItem, type Payment,
} from "@/lib/invoice";

// ── Helpers ──────────────────────────────────────────────────────────────────

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function newInvoiceNumber(): string {
  const d = new Date();
  return `INV-${d.getFullYear()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}
function newLine(): InvoiceLineItem {
  return { id: crypto.randomUUID(), description: "", quantity: "1", unitPrice: "", perGuest: false, taxable: true };
}
function newPayment(): Payment {
  return { id: crypto.randomUUID(), date: todayStr(), method: "", amount: "" };
}

const PAYMENT_METHODS = ["Check", "Credit Card", "ACH", "Wire", "Cash", "Other"];

interface ProposalLite { id: string; company: string; client: string; email: string; event: string; eventDates: string; guests: string; }

// ── Page ─────────────────────────────────────────────────────────────────────

export default function InvoicePage() {
  const [inv, setInv] = useState<InvoiceData>(() => ({
    invoiceNumber: newInvoiceNumber(),
    company: "", contact: "", email: "", event: "", eventDate: "", guestCount: "",
    issueDate: todayStr(), dueDate: "",
    lineItems: [newLine()],
    payments: [],
    taxRate: DEFAULT_TAX_RATE,
    notes: "",
  }));
  const [proposals, setProposals] = useState<ProposalLite[]>([]);
  const [generating, setGenerating] = useState(false);

  // Load proposals for optional client autofill
  useEffect(() => {
    fetch("/api/proposals")
      .then((r) => (r.ok ? r.json() : { proposals: [] }))
      .then((b) => setProposals(b.proposals ?? []))
      .catch(() => {});
  }, []);

  const t = computeInvoice(inv);

  function setField<K extends keyof InvoiceData>(key: K, value: InvoiceData[K]) {
    setInv((p) => ({ ...p, [key]: value }));
  }
  function updateLine(id: string, patch: Partial<InvoiceLineItem>) {
    setInv((p) => ({ ...p, lineItems: p.lineItems.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  }
  function addLine() { setInv((p) => ({ ...p, lineItems: [...p.lineItems, newLine()] })); }
  function removeLine(id: string) { setInv((p) => ({ ...p, lineItems: p.lineItems.filter((l) => l.id !== id) })); }

  function insertPreset(presetId: string) {
    const preset = presetData.presets.find((x) => x.id === presetId);
    if (!preset) return;
    const items: InvoiceLineItem[] = preset.items.map((it) => ({
      id: crypto.randomUUID(),
      description: it.description,
      quantity: "1",
      unitPrice: it.unitPrice,
      perGuest: it.perGuest,
      taxable: it.taxable,
    }));
    setInv((p) => {
      // drop a single empty starter line if it is still blank
      const base = p.lineItems.length === 1 && !p.lineItems[0].description && !p.lineItems[0].unitPrice ? [] : p.lineItems;
      return { ...p, lineItems: [...base, ...items] };
    });
  }

  function updatePayment(id: string, patch: Partial<Payment>) {
    setInv((p) => ({ ...p, payments: p.payments.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  }
  function addPayment() { setInv((p) => ({ ...p, payments: [...p.payments, newPayment()] })); }
  function removePayment(id: string) { setInv((p) => ({ ...p, payments: p.payments.filter((x) => x.id !== id) })); }

  function fillFromProposal(id: string) {
    const p = proposals.find((x) => x.id === id);
    if (!p) return;
    setInv((prev) => ({
      ...prev,
      company: p.company || prev.company,
      contact: p.client || prev.contact,
      email: p.email || prev.email,
      event: p.event || prev.event,
      eventDate: p.eventDates || prev.eventDate,
      guestCount: (p.guests || prev.guestCount).replace(/[^0-9]/g, "") || prev.guestCount,
    }));
  }

  async function downloadPdf() {
    if (generating) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/invoice-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(inv),
      });
      if (!res.ok) throw new Error("PDF failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(inv.invoiceNumber || "invoice").toLowerCase()}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* noop */
    } finally {
      setGenerating(false);
    }
  }

  const inputCls = "w-full border-2 border-stone-300 rounded-md px-3 py-2 text-[14px] bg-white text-stone-900 placeholder-stone-400";

  return (
    <div className="min-h-screen" style={{ background: "#f5f4f2" }}>
      <div style={{ height: 4, background: "var(--emrg-red)" }} />
      <InvoiceHeader />

      <div className="px-8 py-8 max-w-[1000px] mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-[11px] font-bold tracking-[0.22em] uppercase text-stone-500">Invoice</p>
            <input value={inv.invoiceNumber} onChange={(e) => setField("invoiceNumber", e.target.value)}
              className="text-[24px] font-bold text-stone-900 bg-transparent outline-none" />
          </div>
          {t.paidInFull && (
            <span className="px-4 py-2 rounded-md text-[14px] font-bold uppercase tracking-wider border-2"
              style={{ color: "#15803d", borderColor: "#15803d" }}>Paid in Full</span>
          )}
        </div>

        {/* Client / event */}
        <div className="bg-white border border-stone-200 rounded-lg p-5 mb-5">
          {proposals.length > 0 && (
            <div className="mb-4">
              <FieldLabel>Start from a proposal (optional)</FieldLabel>
              <select defaultValue="" onChange={(e) => { if (e.target.value) fillFromProposal(e.target.value); }}
                className={inputCls}>
                <option value="">Select a proposal to pull client details…</option>
                {proposals.map((p) => (
                  <option key={p.id} value={p.id}>{p.company || p.client} · {p.event} {p.id}</option>
                ))}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div><FieldLabel>Company</FieldLabel><input className={inputCls} value={inv.company} onChange={(e) => setField("company", e.target.value)} placeholder="Client company" /></div>
            <div><FieldLabel>Contact</FieldLabel><input className={inputCls} value={inv.contact} onChange={(e) => setField("contact", e.target.value)} placeholder="Contact name" /></div>
            <div><FieldLabel>Email</FieldLabel><input className={inputCls} value={inv.email} onChange={(e) => setField("email", e.target.value)} placeholder="client@company.com" /></div>
            <div><FieldLabel>Event</FieldLabel><input className={inputCls} value={inv.event} onChange={(e) => setField("event", e.target.value)} placeholder="Holiday Party" /></div>
            <div><FieldLabel>Event date</FieldLabel><input className={inputCls} value={inv.eventDate} onChange={(e) => setField("eventDate", e.target.value)} placeholder="December 10, 2026" /></div>
            <div><FieldLabel>Guest count</FieldLabel><input className={inputCls} value={inv.guestCount} onChange={(e) => setField("guestCount", e.target.value.replace(/[^0-9]/g, ""))} placeholder="250" inputMode="numeric" /></div>
            <div><FieldLabel>Issue date</FieldLabel><input className={inputCls} value={inv.issueDate} onChange={(e) => setField("issueDate", e.target.value)} placeholder="YYYY-MM-DD" /></div>
            <div><FieldLabel>Due date</FieldLabel><input className={inputCls} value={inv.dueDate} onChange={(e) => setField("dueDate", e.target.value)} placeholder="YYYY-MM-DD" /></div>
          </div>
        </div>

        {/* Line items */}
        <div className="bg-white border border-stone-200 rounded-lg p-5 mb-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-bold tracking-[0.22em] uppercase text-stone-500">Line Items</p>
            <div className="flex items-center gap-3">
              <select defaultValue="" onChange={(e) => { if (e.target.value) { insertPreset(e.target.value); e.target.value = ""; } }}
                className="border-2 border-stone-300 rounded-md px-3 py-1.5 text-[12px] font-semibold text-stone-700 bg-white">
                <option value="">Insert preset…</option>
                {presetData.presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-[13px]" style={{ minWidth: 720 }}>
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-stone-500 border-b border-stone-200">
                  <th className="py-2 pr-2 font-semibold">Description</th>
                  <th className="py-2 px-2 font-semibold w-16 text-right">Qty</th>
                  <th className="py-2 px-2 font-semibold w-20 text-center">Per guest</th>
                  <th className="py-2 px-2 font-semibold w-28 text-right">Unit price</th>
                  <th className="py-2 px-2 font-semibold w-14 text-center">Tax</th>
                  <th className="py-2 px-2 font-semibold w-28 text-right">Amount</th>
                  <th className="py-2 pl-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {t.lines.map((l) => (
                  <tr key={l.id} className="border-b border-stone-100">
                    <td className="py-1.5 pr-2">
                      <input value={l.description} onChange={(e) => updateLine(l.id, { description: e.target.value })}
                        placeholder="Item description"
                        className="w-full border border-stone-200 rounded px-2 py-1.5 text-[13px] bg-white" />
                    </td>
                    <td className="py-1.5 px-2">
                      <input value={l.perGuest ? String(l.effectiveQty) : l.quantity}
                        onChange={(e) => updateLine(l.id, { quantity: e.target.value.replace(/[^0-9]/g, "") })}
                        disabled={l.perGuest} inputMode="numeric"
                        className="w-full border border-stone-200 rounded px-2 py-1.5 text-[13px] text-right bg-white disabled:bg-stone-100 disabled:text-stone-400" />
                    </td>
                    <td className="py-1.5 px-2 text-center">
                      <input type="checkbox" checked={l.perGuest} onChange={(e) => updateLine(l.id, { perGuest: e.target.checked })}
                        className="h-4 w-4" style={{ accentColor: "var(--emrg-red)" }} />
                    </td>
                    <td className="py-1.5 px-2">
                      <input value={l.unitPrice} onChange={(e) => updateLine(l.id, { unitPrice: e.target.value.replace(/[^0-9.]/g, "") })}
                        placeholder="0.00"
                        className="w-full border border-stone-200 rounded px-2 py-1.5 text-[13px] text-right bg-white" />
                    </td>
                    <td className="py-1.5 px-2 text-center">
                      <input type="checkbox" checked={l.taxable} onChange={(e) => updateLine(l.id, { taxable: e.target.checked })}
                        className="h-4 w-4" style={{ accentColor: "var(--emrg-red)" }} />
                    </td>
                    <td className="py-1.5 px-2 text-right font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>{fmtMoney(l.lineTotal)}</td>
                    <td className="py-1.5 pl-2 text-center">
                      <button onClick={() => removeLine(l.id)} className="text-stone-300 hover:text-[color:var(--emrg-red)] text-lg leading-none" aria-label="Remove line">×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button onClick={addLine} className="mt-3 text-[12px] font-bold uppercase tracking-wider" style={{ color: "var(--emrg-red)" }}>
            + Add line
          </button>
        </div>

        {/* Totals */}
        <div className="flex justify-end mb-5">
          <div className="bg-white border border-stone-200 rounded-lg p-5 w-full max-w-sm">
            <div className="flex justify-between py-1 text-[14px]"><span className="text-stone-500">Subtotal</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{fmtMoney(t.subtotal)}</span></div>
            <div className="flex justify-between py-1 text-[14px]">
              <span className="text-stone-500 flex items-center gap-2">
                Tax
                <input value={String(inv.taxRate)} onChange={(e) => setField("taxRate", parseFloat(e.target.value.replace(/[^0-9.]/g, "")) || 0)}
                  className="w-14 border border-stone-200 rounded px-1.5 py-0.5 text-[12px] text-right" />%
                <span className="text-stone-400 text-[12px]">on {fmtMoney(t.taxableSubtotal)}</span>
              </span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmtMoney(t.tax)}</span>
            </div>
            <div className="flex justify-between py-2 mt-1 border-t border-stone-300 text-[16px] font-bold"><span>Total</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{fmtMoney(t.total)}</span></div>
            {t.paid > 0 && <div className="flex justify-between py-1 text-[14px]"><span className="text-stone-500">Paid to date</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{fmtMoney(t.paid)}</span></div>}
            <div className="flex justify-between py-2 mt-1 rounded-md px-2 text-[15px] font-bold" style={{ background: t.paidInFull ? "#dcf2dc" : "#fdf0d5", color: t.paidInFull ? "#15803d" : "#92600a" }}>
              <span>Balance Due</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{fmtMoney(Math.max(0, t.balance))}</span>
            </div>
          </div>
        </div>

        {/* Payments */}
        <div className="bg-white border border-stone-200 rounded-lg p-5 mb-6">
          <p className="text-[11px] font-bold tracking-[0.22em] uppercase text-stone-500 mb-3">Payment Log</p>
          {inv.payments.length === 0 && <p className="text-[13px] text-stone-400 mb-3">No payments recorded yet. Add the deposit or any payment received.</p>}
          {inv.payments.map((p) => (
            <div key={p.id} className="flex items-center gap-3 mb-2">
              <input value={p.date} onChange={(e) => updatePayment(p.id, { date: e.target.value })} placeholder="YYYY-MM-DD"
                className="border-2 border-stone-300 rounded-md px-3 py-2 text-[13px] w-40" />
              <select value={p.method} onChange={(e) => updatePayment(p.id, { method: e.target.value })}
                className="border-2 border-stone-300 rounded-md px-3 py-2 text-[13px] flex-1 bg-white">
                <option value="">Method…</option>
                {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <div className="relative w-36">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-[13px]">$</span>
                <input value={p.amount} onChange={(e) => updatePayment(p.id, { amount: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="0.00"
                  className="border-2 border-stone-300 rounded-md pl-6 pr-3 py-2 text-[13px] w-full text-right" />
              </div>
              <button onClick={() => removePayment(p.id)} className="text-stone-300 hover:text-[color:var(--emrg-red)] text-lg leading-none px-1" aria-label="Remove payment">×</button>
            </div>
          ))}
          <button onClick={addPayment} className="mt-2 text-[12px] font-bold uppercase tracking-wider" style={{ color: "var(--emrg-red)" }}>+ Add payment</button>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <p className="text-[12px] text-stone-400 max-w-md">Draft format. Preset prices are placeholders until Olivia&apos;s list is in, and the layout will be matched to EMRG&apos;s real invoices.</p>
          <button onClick={downloadPdf} disabled={generating}
            className="py-3 px-8 text-[13px] font-bold tracking-[0.2em] uppercase rounded-md text-white transition-opacity disabled:opacity-40"
            style={{ background: "var(--emrg-red)" }}>
            {generating ? "Generating…" : "Download PDF"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-[10px] font-bold tracking-[0.18em] uppercase mb-1" style={{ color: "#111111" }}>{children}</label>;
}

async function logout() {
  await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ logout: true }) }).catch(() => {});
  window.location.href = "/login";
}

function InvoiceHeader() {
  return (
    <header style={{ background: "var(--emrg-black)" }} className="text-white px-10 py-5 flex items-center relative">
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-bold tracking-tight">EMRG</span>
        <span className="text-xl font-light tracking-[0.18em] text-white/50">MEDIA</span>
      </div>
      <nav className="lg:absolute lg:left-1/2 lg:-translate-x-1/2 flex items-center gap-6 lg:gap-10 ml-auto lg:ml-0">
        <a href="/" className="text-[11px] tracking-[0.22em] uppercase transition-colors pb-0.5" style={{ color: "rgba(255,255,255,0.45)" }}>New Proposal</a>
        <a href="/dashboard" className="text-[11px] tracking-[0.22em] uppercase transition-colors pb-0.5" style={{ color: "rgba(255,255,255,0.45)" }}>Dashboard</a>
        <a href="/invoice" className="text-[11px] tracking-[0.22em] uppercase pb-0.5" style={{ color: "#fff", borderBottom: "1px solid var(--emrg-red)" }}>Invoice</a>
      </nav>
      <button onClick={logout} className="ml-6 lg:ml-auto text-[11px] tracking-[0.22em] uppercase text-white/40 hover:text-white/80 transition-colors">Log out</button>
    </header>
  );
}
