"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import lineItems from "@/data/line-items.json";

// ── Constants ────────────────────────────────────────────────────────────────

const EVENT_TYPES = [
  "Corporate Event","Holiday Party","Conference","Client Summit",
  "Bar Mitzvah","Bat Mitzvah","Fundraiser","Charity Gala",
  "Product Launch","Experiential Marketing Event","Corporate Retreat",
  "Engagement Party","Wedding","Networking Event","Awards Gala",
  "Investor Event","Executive Retreat","Trade Show",
  "Employee Appreciation Event","Sales Meeting","Annual Meeting",
  "Board Meeting","Team Building Activity","Training Seminar",
  "Grand Opening / Ribbon Cutting","Pop-Up Event","Celebrity Event",
  "Anniversary Party","Birthday Party","Sweet 16",
  "Walk / Run Fundraiser","Other",
];

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const EMRG_ADDRESS = "EMRG Media, 60 Sutton Place South, Suite 8LS  New York NY 10022  |  212.254.3700";

type ServiceItem = { id: string; label: string; default: boolean };
type ServiceState = Record<string, boolean>;

interface EventEntry {
  id: string;
  date: string;
  eventTypes: string[];
  guestCount: string; // raw while typing
  guestCountFormatted: string; // after blur
}

interface ClientFields {
  client_name: string;
  signer_name: string;
  signer_title: string;
  client_email: string;
  venue: string;
  prepared_by: string;
  budget_low: string;
  budget_high: string;
  service_fee: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return "";
  return "$" + parseInt(digits, 10).toLocaleString("en-US");
}

function formatGuestCount(raw: string): string {
  // Handle ranges like "100-150" — format each part
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const rangeMatch = trimmed.match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (rangeMatch) {
    const lo = parseInt(rangeMatch[1], 10).toLocaleString("en-US");
    const hi = parseInt(rangeMatch[2], 10).toLocaleString("en-US");
    return `${lo}-${hi} ppl`;
  }
  const digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return trimmed + " ppl"; // leave non-numeric text + ppl
  return parseInt(digits, 10).toLocaleString("en-US") + " ppl";
}

function parseDate(raw: string): { month: number; day: number; year: number } | null {
  if (!raw.trim()) return null;
  const trimmed = raw.trim();
  const currentYear = new Date().getFullYear();
  const normalised = trimmed.replace(/\//g, "-");
  const mdyMatch = normalised.match(/^(\d{1,2})[- .](\d{1,2})(?:[- .](\d{2,4}))?$/);
  if (mdyMatch) {
    const [, a, b, y] = mdyMatch;
    const year = !y ? currentYear : y.length === 2 ? 2000 + parseInt(y) : parseInt(y);
    const month = parseInt(a) - 1;
    const day = parseInt(b);
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) return { month, day, year };
  }
  // Month-name formats: "December 10", "December 10, 2026", "Dec 10 26", "10 December"
  const nameMatch = trimmed.match(/^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:[,\s]+(\d{2,4}))?$/) ||
    trimmed.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]+)\.?(?:[,\s]+(\d{2,4}))?$/);
  if (nameMatch) {
    const monthStr = /^\d/.test(nameMatch[1]) ? nameMatch[2] : nameMatch[1];
    const dayStr = /^\d/.test(nameMatch[1]) ? nameMatch[1] : nameMatch[2];
    const y = nameMatch[3];
    const month = MONTHS.findIndex((m) => m.toLowerCase().startsWith(monthStr.toLowerCase().slice(0, 3)));
    const day = parseInt(dayStr);
    // No year given → default to the current year, never let JS guess
    const year = !y ? currentYear : y.length === 2 ? 2000 + parseInt(y) : parseInt(y);
    if (month >= 0 && day >= 1 && day <= 31) return { month, day, year };
  }
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) {
    // JS parses year-less dates into garbage years (e.g. 2001) — override with current year
    const year = /\b(19|20)\d{2}\b/.test(trimmed) ? d.getFullYear() : currentYear;
    return { month: d.getMonth(), day: d.getDate(), year };
  }
  return null;
}

// Map free-text event types to the canonical dropdown options (case-insensitive),
// title-case anything unknown, and dedupe.
function normalizeEventTypes(types: string[]): string[] {
  const out: string[] = [];
  for (const raw of types) {
    const t = raw.trim();
    if (!t) continue;
    const canonical = EVENT_TYPES.find((e) => e.toLowerCase() === t.toLowerCase());
    const value = canonical ?? t.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1));
    if (!out.some((x) => x.toLowerCase() === value.toLowerCase())) out.push(value);
  }
  return out;
}

function currencyToNumber(v: string): number | null {
  const digits = v.replace(/[^\d]/g, "");
  return digits ? parseInt(digits, 10) : null;
}

function dateSuffix(day: number): string {
  return [11,12,13].includes(day % 100) ? "th"
    : day % 10 === 1 ? "st" : day % 10 === 2 ? "nd" : day % 10 === 3 ? "rd" : "th";
}

function formatDateLong(raw: string): string {
  const parsed = parseDate(raw);
  if (!parsed) return raw;
  const { month, day, year } = parsed;
  return `${MONTHS[month]} ${day}${dateSuffix(day)}, ${year}`;
}

function formatDatePlain(raw: string): string {
  const parsed = parseDate(raw);
  if (!parsed) return raw;
  return `${MONTHS[parsed.month]} ${parsed.day}, ${parsed.year}`;
}

function formatDateOrdinalNoYear(raw: string): string {
  const parsed = parseDate(raw);
  if (!parsed) return raw;
  return `${MONTHS[parsed.month]} ${parsed.day}${dateSuffix(parsed.day)}`;
}

// "Dr. Lisa Park" → "Lisa"; "Jane Smith" → "Jane"
function greetingName(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  const isHonorific = (w: string) => /^(dr|mr|mrs|ms|miss|prof|rev)\.?$/i.test(w);
  if (words.length === 0) return "";
  if (isHonorific(words[0])) return words.length > 2 ? words[1] : words.join(" ");
  return words[0];
}

function newEvent(): EventEntry {
  return { id: crypto.randomUUID(), date: "", eventTypes: [], guestCount: "", guestCountFormatted: "" };
}

function buildInitialServices(): ServiceState {
  const s: ServiceState = {};
  for (const item of lineItems.core_services as ServiceItem[]) s[item.id] = item.default;
  for (const item of lineItems.addon_services as ServiceItem[]) s[item.id] = item.default;
  return s;
}

const initialClient: ClientFields = {
  client_name: "", signer_name: "", signer_title: "", client_email: "",
  venue: "", prepared_by: "",
  budget_low: "", budget_high: "", service_fee: "",
};

// One ID per proposal (form session) — generate and send log to the same sheet row
function newProposalId(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `EMRG-${ymd}-${rand}`;
}

// ── Event Type multi-select (reusable) ───────────────────────────────────────

function EventTypeSelect({
  selected, onChange,
}: { selected: string[]; onChange: (types: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function h(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  function toggle(t: string) {
    onChange(selected.includes(t) ? selected.filter((x) => x !== t) : [...selected, t]);
  }

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full text-left border-2 border-stone-400 rounded-md px-4 py-2.5 text-[16px] bg-white flex items-center justify-between gap-2 transition-colors"
        style={{ color: selected.length ? "#111111" : "#9ca3af" }}>
        <span className="truncate">
          {selected.length === 0 ? "Select event type(s)..." : selected.join(", ")}
        </span>
        <svg width="11" height="7" viewBox="0 0 11 7" fill="none" className="flex-shrink-0">
          <path d="M1 1l4.5 4.5L10 1" stroke="#c0b8ae" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-stone-200 rounded-lg shadow-lg overflow-hidden">
          <div className="max-h-56 overflow-y-auto py-1">
            {EVENT_TYPES.map((t) => (
              <label key={t} className="flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-stone-50">
                <input type="checkbox" checked={selected.includes(t)} onChange={() => toggle(t)}
                  className="h-4 w-4 flex-shrink-0 rounded border-stone-300" />
                <span className="text-[16px] text-stone-900">{t}</span>
              </label>
            ))}
          </div>
          {selected.length > 0 && (
            <div className="border-t border-stone-100 px-4 py-2 flex justify-end">
              <button onClick={() => onChange([])}
                className="text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--emrg-red)" }}>Clear all</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function NewProposalPage() {
  const [client, setClient] = useState<ClientFields>(initialClient);
  const [events, setEvents] = useState<EventEntry[]>([newEvent()]);
  const [services, setServices] = useState<ServiceState>(buildInitialServices);
  const [customServices, setCustomServices] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState("");
  const [importNotes, setImportNotes] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [sentAt, setSentAt] = useState("");
  const [proposalId] = useState(newProposalId);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");

  // ── Client field handlers ─────────────────────────────────────────────────

  function handleClientText(e: React.ChangeEvent<HTMLInputElement>) {
    setClient((p) => ({ ...p, [e.target.name]: e.target.value }));
  }

  function handleCurrencyChange(name: keyof ClientFields) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setClient((p) => ({ ...p, [name]: e.target.value.replace(/[^\d$,]/g, "") }));
    };
  }

  function handleCurrencyBlur(name: keyof ClientFields) {
    return () => setClient((p) => ({ ...p, [name]: formatCurrency(p[name]) }));
  }

  // ── Event entry handlers ──────────────────────────────────────────────────

  function updateEvent(id: string, patch: Partial<EventEntry>) {
    setEvents((prev) => prev.map((e) => e.id === id ? { ...e, ...patch } : e));
  }

  function addEvent() {
    setEvents((prev) => [...prev, newEvent()]);
  }

  function removeEvent(id: string) {
    setEvents((prev) => prev.filter((e) => e.id !== id));
  }

  function handleGuestChange(id: string, val: string) {
    updateEvent(id, { guestCount: val.replace(/[^\d\-–,]/g, "") });
  }

  function handleGuestBlur(id: string, raw: string) {
    updateEvent(id, { guestCountFormatted: formatGuestCount(raw) });
  }

  // ── Services ──────────────────────────────────────────────────────────────

  function toggleService(id: string) {
    setServices((p) => ({ ...p, [id]: !p[id] }));
  }

  function addCustomService() {
    const t = customInput.trim();
    if (!t) return;
    setCustomServices((p) => [...p, t]);
    setCustomInput("");
  }

  function removeCustomService(i: number) {
    setCustomServices((p) => p.filter((_, idx) => idx !== i));
  }

  // ── Smart Import ──────────────────────────────────────────────────────────

  async function handleSmartImport() {
    if (!importNotes.trim() || importing) return;
    setImporting(true);
    setImportError("");
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: importNotes }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Request failed");
      }
      const data = await res.json();

      if (data.client_name) setClient((p) => ({ ...p, client_name: data.client_name }));
      if (data.signer_name) setClient((p) => ({ ...p, signer_name: data.signer_name }));
      if (data.signer_title) setClient((p) => ({ ...p, signer_title: data.signer_title }));
      if (data.client_email) setClient((p) => ({ ...p, client_email: data.client_email }));
      if (data.venue) setClient((p) => ({ ...p, venue: data.venue }));
      if (data.budget_low) setClient((p) => ({ ...p, budget_low: formatCurrency(data.budget_low) }));
      if (data.budget_high) setClient((p) => ({ ...p, budget_high: formatCurrency(data.budget_high) }));
      if (data.service_fee) setClient((p) => ({ ...p, service_fee: data.service_fee.includes("%") ? data.service_fee : formatCurrency(data.service_fee) }));

      if (Array.isArray(data.events) && data.events.length > 0) {
        setEvents(data.events.map((ev: { date?: string; eventTypes?: string[]; guestCount?: string }) => ({
          id: crypto.randomUUID(),
          date: ev.date ?? "",
          eventTypes: normalizeEventTypes(Array.isArray(ev.eventTypes) ? ev.eventTypes : []),
          guestCount: ev.guestCount ?? "",
          guestCountFormatted: ev.guestCount ? formatGuestCount(ev.guestCount) : "",
        })));
      }
      setImportNotes("");
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Could not extract data.");
    } finally {
      setImporting(false);
    }
  }

  // ── Generate PDF ─────────────────────────────────────────────────────────

  async function handleGeneratePdf() {
    if (generatingPdf) return;
    setGeneratingPdf(true);
    try {
      const res = await fetch("/api/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...client, proposal_id: proposalId, events, selectedServices }),
      });
      if (!res.ok) throw new Error("PDF generation failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(client.client_name || "proposal").replace(/[^a-z0-9]/gi, "-").toLowerCase()}-proposal.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
    } finally {
      setGeneratingPdf(false);
    }
  }

  // ── Send to client ───────────────────────────────────────────────────────

  function buildEmailDefaults() {
    const firstName = greetingName(client.signer_name) || "there";
    const eventTypes = [...new Set(events.flatMap((e) => e.eventTypes))];
    const eventLabel = eventTypes.join(" / ");
    const dateOrdinal = events[0]?.date ? formatDateOrdinalNoYear(events[0].date) : "";
    const subject = `${client.client_name || "Your Event"} ${eventLabel} | Proposal from EMRG Media`.replace(/\s+/g, " ").trim();
    const body = [
      `Hi ${firstName},`,
      ``,
      `Great speaking with you. Attached is our proposal and agreement for ${client.client_name ? `${client.client_name}'s` : "your"} ${eventLabel ? eventLabel.toLowerCase() : "event"}${dateOrdinal ? ` on ${dateOrdinal}` : ""}.`,
      ``,
      `Everything we discussed is reflected in the scope. Review at your convenience, and I'm happy to jump on a call with any questions.`,
      ``,
      `Talk soon,`,
      `Mario`,
      ``,
      `Mario Stewart | Founder and CEO, EMRG Media`,
      `212.254.3700 | www.emrgmedia.com`,
    ].join("\n");
    return { subject, body };
  }

  function openEmailPreview() {
    const d = buildEmailDefaults();
    setEmailSubject(d.subject);
    setEmailBody(d.body);
    setSendError("");
    setEmailModalOpen(true);
  }

  async function handleSendToClient() {
    if (sending) return;
    setSending(true);
    setSendError("");
    setSentAt("");
    try {
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...client, proposal_id: proposalId, events, selectedServices, subject: emailSubject, body: emailBody }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Send failed");
      setEmailModalOpen(false);
      setSentAt(new Date().toLocaleString("en-US", {
        month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
      }));
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Could not send email.");
    } finally {
      setSending(false);
    }
  }

  // ── Derived values ────────────────────────────────────────────────────────

  const selectedServices = [
    ...(lineItems.core_services as ServiceItem[]).filter((s) => services[s.id]).map((s) => s.label),
    ...(lineItems.addon_services as ServiceItem[]).filter((s) => services[s.id]).map((s) => s.label),
    ...customServices,
  ];

  const hasAnyField =
    Object.values(client).some((v) => v.trim() !== "") ||
    events.some((e) => e.date || e.eventTypes.length > 0 || e.guestCount) ||
    selectedServices.length > 0;

  const multipleEvents = events.length > 1;

  const budgetLowNum = currencyToNumber(client.budget_low);
  const budgetHighNum = currencyToNumber(client.budget_high);
  const budgetInvalid =
    budgetLowNum !== null && budgetHighNum !== null && budgetLowNum > budgetHighNum;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col">
      <div style={{ height: 4, background: "var(--emrg-red)" }} />

      <header style={{ background: "var(--emrg-black)" }} className="text-white px-10 py-5 flex items-center relative">
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold tracking-tight">EMRG</span>
          <span className="text-xl font-light tracking-[0.18em] text-white/50">MEDIA</span>
        </div>
        <nav className="lg:absolute lg:left-1/2 lg:-translate-x-1/2 flex items-center gap-6 lg:gap-10 ml-auto lg:ml-0">
          <a href="/" className="text-[11px] tracking-[0.22em] uppercase pb-0.5"
            style={{ color: "#fff", borderBottom: "1px solid var(--emrg-red)" }}>
            New Proposal
          </a>
          <a href="/dashboard" className="text-[11px] tracking-[0.22em] uppercase transition-colors pb-0.5"
            style={{ color: "rgba(255,255,255,0.45)" }}>
            Dashboard
          </a>
        </nav>
        <button
          onClick={async () => {
            await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ logout: true }) }).catch(() => {});
            window.location.href = "/login";
          }}
          className="ml-6 lg:ml-auto text-[11px] tracking-[0.22em] uppercase text-white/40 hover:text-white/80 transition-colors">
          Log out
        </button>
      </header>

      <div className="flex flex-1 overflow-hidden" style={{ height: "calc(100vh - 69px)" }}>

        {/* ── LEFT: Form ── */}
        <div className="w-[44%] overflow-y-auto bg-white border-r border-stone-200">
          <div className="px-9 pt-8 pb-14">

            {/* Smart Import */}
            <div className="mb-8 rounded-lg border-2 border-dashed border-stone-400 bg-stone-50 p-5">
              <p className="text-[11px] font-bold tracking-[0.22em] uppercase mb-1.5" style={{ color: "#111111" }}>
                Smart Import
              </p>
              <textarea
                value={importNotes}
                onChange={(e) => setImportNotes(e.target.value)}
                placeholder="Paste discovery call notes or a transcript to auto-fill the form."
                className="w-full h-36 text-[14px] resize-none bg-transparent outline-none leading-relaxed text-stone-900 placeholder-stone-400"
              />
              {importError && (
                <p className="text-[10px] mt-1" style={{ color: "var(--emrg-red)" }}>{importError}</p>
              )}
              <div className="flex justify-end mt-2">
                <button
                  onClick={handleSmartImport}
                  disabled={!importNotes.trim() || importing}
                  className="text-[9px] font-bold tracking-[0.18em] uppercase px-3 py-1.5 rounded transition-opacity disabled:opacity-40"
                  style={{ background: "var(--emrg-red)", color: "#fff" }}>
                  {importing ? "Extracting…" : "Auto-fill form"}
                </button>
              </div>
            </div>

            {/* Client */}
            <SectionLabel>Client Details</SectionLabel>
            <div className="space-y-4 mb-9">
              <TextField label="Client / Company Name" name="client_name" value={client.client_name}
                onChange={handleClientText} required />
              <div className="grid grid-cols-2 gap-3">
                <TextField label="Signer Name" name="signer_name" value={client.signer_name}
                  onChange={handleClientText} placeholder="Jane Smith" required />
                <TextField label="Signer Title" name="signer_title" value={client.signer_title}
                  onChange={handleClientText} placeholder="Head of Events" />
              </div>
              <TextField label="Client Email" name="client_email" value={client.client_email}
                onChange={handleClientText} placeholder="jane@company.com" />
              <div className="grid grid-cols-2 gap-3">
                <TextField label="Venue" name="venue" value={client.venue}
                  onChange={handleClientText} placeholder="TBD or venue name" />
                <TextField label="Prepared By" name="prepared_by" value={client.prepared_by}
                  onChange={handleClientText} placeholder="Your name" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel>Budget (low)</FieldLabel>
                  <input type="text" value={client.budget_low}
                    onChange={handleCurrencyChange("budget_low")} onBlur={handleCurrencyBlur("budget_low")}
                    placeholder="$50,000"
                    className="w-full border-2 border-stone-400 rounded-md px-4 py-2.5 text-[16px] bg-white text-stone-900 placeholder-stone-400 transition-colors" />
                </div>
                <div>
                  <FieldLabel>Budget (high)</FieldLabel>
                  <input type="text" value={client.budget_high}
                    onChange={handleCurrencyChange("budget_high")} onBlur={handleCurrencyBlur("budget_high")}
                    placeholder="$75,000"
                    className="w-full border-2 border-stone-400 rounded-md px-4 py-2.5 text-[16px] bg-white text-stone-900 placeholder-stone-400 transition-colors"
                    style={budgetInvalid ? { borderColor: "var(--emrg-red)" } : undefined} />
                </div>
              </div>
              {budgetInvalid && (
                <p className="text-[13px] font-semibold -mt-2" style={{ color: "var(--emrg-red)" }}>
                  Low budget is higher than high budget — swap the values before generating.
                </p>
              )}
              <div>
                <FieldLabel required>EMRG Service Fee</FieldLabel>
                <input type="text" value={client.service_fee}
                  onChange={handleCurrencyChange("service_fee")} onBlur={handleCurrencyBlur("service_fee")}
                  placeholder="$12,000"
                  className="w-full border-2 border-stone-400 rounded-md px-4 py-2.5 text-[16px] bg-white text-stone-900 placeholder-stone-400 transition-colors" />
              </div>
            </div>

            {/* Event Dates */}
            <SectionLabel>Event Dates</SectionLabel>
            <div className="space-y-5 mb-4">
              {events.map((ev, idx) => (
                <div key={ev.id} className="rounded-lg border border-stone-150 bg-stone-50/50 p-4 space-y-3 relative"
                  style={{ borderColor: "#ede9e3" }}>
                  {/* Row label + remove */}
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-bold tracking-[0.2em] uppercase" style={{ color: "#111111" }}>
                      Event {idx + 1}
                    </span>
                    {events.length > 1 && (
                      <button onClick={() => removeEvent(ev.id)}
                        className="text-[9px] font-bold uppercase tracking-wider transition-opacity"
                        style={{ color: "var(--emrg-red)" }}>Remove</button>
                    )}
                  </div>

                  <div>
                    <FieldLabel required>Date</FieldLabel>
                    <input type="text" value={ev.date}
                      onChange={(e) => updateEvent(ev.id, { date: e.target.value })}
                      placeholder="e.g. June 15, 2026 or 06/15/26"
                      className="w-full border-2 border-stone-400 rounded-md px-4 py-2.5 text-[16px] bg-white text-stone-900 placeholder-stone-400 transition-colors" />
                  </div>

                  <div>
                    <FieldLabel required>Event Type</FieldLabel>
                    <EventTypeSelect
                      selected={ev.eventTypes}
                      onChange={(types) => updateEvent(ev.id, { eventTypes: types })} />
                  </div>

                  <div>
                    <FieldLabel required>Estimated Guest Count</FieldLabel>
                    <input type="text" inputMode="numeric" value={ev.guestCount}
                      onChange={(e) => handleGuestChange(ev.id, e.target.value)}
                      onBlur={(e) => handleGuestBlur(ev.id, e.target.value)}
                      placeholder="e.g. 250 or 100-150"
                      className="w-full border-2 border-stone-400 rounded-md px-4 py-2.5 text-[16px] bg-white text-stone-900 placeholder-stone-400 transition-colors" />
                    {ev.guestCountFormatted && (
                      <p className="text-[12px] mt-1 ml-0.5" style={{ color: "#111111" }}>
                        Will show as: <strong>{ev.guestCountFormatted}</strong>
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <button onClick={addEvent}
              className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wider mb-9 transition-opacity hover:opacity-70"
              style={{ color: "var(--emrg-red)" }}>
              <span className="text-base leading-none">+</span> Add another event date
            </button>

            {/* Core Services */}
            <SectionLabel>Core Services</SectionLabel>
            <div className="space-y-2.5 mb-8">
              {(lineItems.core_services as ServiceItem[]).map((s) => (
                <CheckRow key={s.id} label={s.label} checked={services[s.id]} onChange={() => toggleService(s.id)} />
              ))}
            </div>

            {/* Add-on Services */}
            <SectionLabel>Add-on Services</SectionLabel>
            <div className="space-y-2.5 mb-8">
              {(lineItems.addon_services as ServiceItem[]).map((s) => (
                <CheckRow key={s.id} label={s.label} checked={services[s.id]} onChange={() => toggleService(s.id)} />
              ))}
            </div>

            {/* Custom Services */}
            <SectionLabel>Custom Services</SectionLabel>
            {customServices.length > 0 && (
              <div className="space-y-1.5 mb-3">
                {customServices.map((label, i) => (
                  <div key={i} className="flex items-center gap-2 group py-0.5">
                    <span className="flex-1 text-[16px] text-stone-900">{label}</span>
                    <button onClick={() => removeCustomService(i)}
                      className="text-[11px] font-bold uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ color: "var(--emrg-red)" }}>Remove</button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2 mb-10">
              <input type="text" value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addCustomService()}
                placeholder="Add a custom service..."
                className="flex-1 border-2 border-stone-400 rounded-md px-4 py-2.5 text-[16px] bg-white text-stone-900 placeholder-stone-400 outline-none transition-colors" />
              <button onClick={addCustomService}
                className="px-5 py-2.5 text-white text-[16px] font-semibold rounded-md hover:opacity-90 transition-opacity"
                style={{ background: "var(--emrg-red)" }}>Add</button>
            </div>

            {budgetInvalid && (
              <p className="text-[13px] font-semibold mb-2 text-center" style={{ color: "var(--emrg-red)" }}>
                Fix the budget range before generating.
              </p>
            )}
            <button
              onClick={handleGeneratePdf}
              disabled={generatingPdf || !hasAnyField || budgetInvalid}
              className="w-full py-3.5 text-[13px] font-bold tracking-[0.2em] uppercase rounded-md transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: "var(--emrg-red)", color: "#fff" }}>
              {generatingPdf ? "Generating…" : "Generate PDF"}
            </button>

            {/* Send to client */}
            <div className="mt-3">
              {!client.client_email.trim() ? (
                <p className="text-[12px] text-stone-500 text-center">
                  Add a client email above to enable sending.
                </p>
              ) : (
                <button
                  onClick={openEmailPreview}
                  disabled={sending || !hasAnyField || budgetInvalid}
                  className="w-full py-3.5 text-[13px] font-bold tracking-[0.2em] uppercase rounded-md border-2 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ borderColor: "var(--emrg-black)", color: "var(--emrg-black)", background: "#fff" }}>
                  Send to Client
                </button>
              )}
              {sendError && (
                <p className="text-[12px] mt-2 text-center" style={{ color: "var(--emrg-red)" }}>{sendError}</p>
              )}
              {sentAt && (
                <p className="text-[13px] font-semibold mt-2 text-center" style={{ color: "#15803d" }}>
                  ✓ Sent to {client.client_email} on {sentAt}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ── RIGHT: Document Preview ── */}
        <div className="w-[56%] overflow-y-auto px-8 py-8" style={{ background: "#e8e4de" }}>
          <p className="text-[11px] font-bold tracking-[0.25em] uppercase mb-6" style={{ color: "#111111" }}>
            Document Preview
          </p>

          {!hasAnyField ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3">
              <div className="w-10 h-10 rounded-full border border-stone-300 flex items-center justify-center">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 2v10M2 7h10" stroke="#c0b8ae" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </div>
              <p className="text-xs" style={{ color: "#c0b8ae" }}>Fill in the form to see the document</p>
            </div>
          ) : (
            <div className="space-y-6">

              {/* ── Page 1: Cover ── */}
              <PagePill>Page 1 · Cover</PagePill>
              <div className="bg-white shadow-md rounded-lg overflow-hidden border border-stone-200/30 flex flex-col items-center justify-center text-center px-10 py-24"
                style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
                <Image src="/emrg-logo.png" alt="EMRG Media" width={240} height={60} style={{ objectFit: "contain" }} className="mb-12" />
                <p className="text-[11px] tracking-[0.3em] text-stone-500 mb-3">PREPARED FOR</p>
                <p className="text-[26px] font-bold text-stone-900 mb-3">
                  {client.client_name || <span className="text-stone-300">_______________</span>}
                </p>
                <p className="text-[13.5px] text-stone-600">
                  {[...new Set(events.flatMap((e) => e.eventTypes))].join(" / ")}
                  {events.flatMap((e) => e.eventTypes).length > 0 && events[0]?.date ? "  |  " : ""}
                  {events[0]?.date ? formatDatePlain(events[0].date) : ""}
                </p>
                <div className="mt-10" style={{ width: 40, height: 2, background: "var(--emrg-red)" }} />
              </div>

              {/* ── Page 2: Intro letter ── */}
              <PagePill>Page 2 · Cover Letter</PagePill>
              <div className="bg-white shadow-md rounded-lg overflow-hidden border border-stone-200/30 px-10 py-8"
                style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
                <div className="flex justify-center mb-8">
                  <Image src="/emrg-logo.png" alt="EMRG Media" width={200} height={50} style={{ objectFit: "contain" }} />
                </div>
                <p className="text-[14.5px] leading-7 text-stone-900 mb-4">
                  Dear {greetingName(client.signer_name) || <span className="inline-block border-b border-stone-400 w-24 align-bottom" />},
                </p>
                <p className="text-[14.5px] leading-7 text-stone-900 mb-4">
                  Thank you for the opportunity to plan{" "}
                  <span className="font-semibold">{client.client_name || "your company"}</span>&apos;s upcoming{" "}
                  {[...new Set(events.flatMap((e) => e.eventTypes))].join(" / ").toLowerCase() || "event"}.
                  {" "}For over 25 years, EMRG Media has produced more than 1,100 events for clients including
                  JPMorgan, Netflix, Bloomberg and Condé Nast, and we would be honored to add this celebration to that list.
                </p>
                <p className="text-[14.5px] leading-7 text-stone-900 mb-4">
                  Enclosed is our proposed scope of services and agreement for your{" "}
                  {events[0]?.date
                    ? <span className="font-semibold">{formatDateOrdinalNoYear(events[0].date)}</span>
                    : "upcoming"}{" "}
                  event
                  {events[0]?.guestCount
                    ? ` for ${(events[0].guestCountFormatted || formatGuestCount(events[0].guestCount)).replace(/\s*ppl$/, "")} guests`
                    : ""}.
                  {" "}Our team handles every detail from venue through day of execution, so your team enjoys
                  the night instead of running it.
                </p>
                <p className="text-[14.5px] leading-7 text-stone-900 mb-8">
                  We look forward to creating something exceptional together.
                </p>
                <p className="text-[14.5px] leading-6 text-stone-900">Warm regards,</p>
                <p className="text-[14.5px] leading-6 font-semibold text-stone-900">Mario Stewart</p>
                <p className="text-[13px] leading-6 text-stone-600">Founder and CEO, EMRG Media</p>
                <p className="text-[13px] leading-6 text-stone-600">212.254.3700</p>
                <div className="border-t border-stone-200 pt-4 mt-8 text-center">
                  <p className="text-[13px] text-stone-800">{EMRG_ADDRESS}</p>
                </div>
              </div>

              {/* ── Page 3+: Agreement ── */}
              <PagePill>Page 3 · Agreement</PagePill>
            <div className="bg-white shadow-md rounded-lg overflow-hidden border border-stone-200/30"
              style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
              <div className="px-10 py-8">

                {/* Logo */}
                <div className="flex justify-center mb-7">
                  <Image src="/emrg-logo.png" alt="EMRG Media" width={220} height={55} style={{ objectFit: "contain" }} />
                </div>

                {/* Intro paragraphs */}
                <p className="text-[14.5px] leading-7 text-stone-900 mb-4">
                  EMRG Media agrees to act as the event planner to coordinate the upcoming event for{" "}
                  <span className="font-semibold">{client.client_name || "_______________"}</span>.{" "}
                  EMRG Media will facilitate all related event planning needs and as outlined below.
                </p>

                <p className="text-[14.5px] leading-7 text-stone-900 mb-4">
                  The parties have discussed a general event overview including an estimated working event budget of{" "}
                  {client.budget_low || client.budget_high ? (
                    <>
                      <span className="font-semibold">{client.budget_low || "___"}</span>
                      {client.budget_low && client.budget_high && " to "}
                      {client.budget_high && <span className="font-semibold">{client.budget_high}</span>}
                    </>
                  ) : "$_______ _______"}.{" "}
                  EMRG Media agrees to work within the parameters of the proposed budget.
                </p>

                <p className="text-[14.5px] leading-7 text-stone-900 mb-6">
                  EMRG Media, LLC will be paid an event management and planning fee of{" "}
                  <span className="font-semibold">{client.service_fee || "$________"}</span>{" "}
                  for the services outlined below in: Event Planner, Event Management and Production Responsibilities.
                </p>

                {/* Client table */}
                <table className="w-full border-collapse mb-0 text-[14.5px]">
                  <tbody>
                    <tr>
                      <td className="border border-stone-400 px-3 py-1.5 font-semibold bg-stone-50 w-28">Client:</td>
                      <td className="border border-stone-400 px-3 py-1.5">
                        {client.client_name || <span className="text-stone-300">_______________</span>}
                      </td>
                    </tr>
                  </tbody>
                </table>

                {/* Event details table — adapts for single vs multi-event */}
                <table className="w-full border-collapse mb-6 text-[14.5px]">
                  <thead>
                    <tr>
                      <th className="border border-stone-400 px-3 py-1.5 text-left font-semibold bg-stone-50 w-[30%]">
                        {multipleEvents ? "Event Dates:" : "Preferred Date:"}
                      </th>
                      <th className="border border-stone-400 px-3 py-1.5 text-left font-semibold bg-stone-50 w-[35%]">
                        {multipleEvents ? "Event Types:" : "Event Type:"}
                      </th>
                      <th className="border border-stone-400 px-3 py-1.5 text-left font-semibold bg-stone-50">
                        {multipleEvents ? "Estimated Guest Counts:" : "Estimated Guest Count:"}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {multipleEvents ? (
                      // Multi-event: one row with stacked values in each cell
                      <tr>
                        <td className="border border-stone-400 px-3 py-2 align-top">
                          {events.map((ev) => (
                            <p key={ev.id} className="leading-6">
                              {ev.date ? formatDateLong(ev.date) : <span className="text-stone-300">___</span>}
                            </p>
                          ))}
                        </td>
                        <td className="border border-stone-400 px-3 py-2 align-top">
                          {events.map((ev) => (
                            <p key={ev.id} className="leading-6">
                              {ev.eventTypes.length > 0
                                ? ev.eventTypes.join(", ")
                                : <span className="text-stone-300">___</span>}
                            </p>
                          ))}
                        </td>
                        <td className="border border-stone-400 px-3 py-2 align-top">
                          {events.map((ev) => {
                            const dateLabel = ev.date ? formatDateLong(ev.date).split(",")[0] : null;
                            const count = ev.guestCountFormatted || (ev.guestCount ? formatGuestCount(ev.guestCount) : "");
                            return (
                              <p key={ev.id} className="leading-6">
                                {dateLabel && <span className="font-medium">{dateLabel}: </span>}
                                {count || <span className="text-stone-300">___</span>}
                              </p>
                            );
                          })}
                        </td>
                      </tr>
                    ) : (
                      // Single event row
                      <tr>
                        <td className="border border-stone-400 px-3 py-2">
                          {events[0]?.date
                            ? formatDateLong(events[0].date)
                            : <span className="text-stone-300">_______________</span>}
                        </td>
                        <td className="border border-stone-400 px-3 py-2">
                          {events[0]?.eventTypes.length > 0
                            ? events[0].eventTypes.join(", ")
                            : <span className="text-stone-300">_______________</span>}
                        </td>
                        <td className="border border-stone-400 px-3 py-2">
                          {events[0]?.guestCount
                            ? (events[0].guestCountFormatted || formatGuestCount(events[0].guestCount))
                            : <span className="text-stone-300">_______________</span>}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>

                {/* Responsibilities */}
                <p className="text-[14.5px] font-bold text-stone-900 mb-3">
                  EMRG Media Event Planner, Event Management and Production Responsibilities:
                </p>
                <div className="mb-5 space-y-1">
                  {selectedServices.length > 0 ? (
                    selectedServices.map((s, i) => (
                      <p key={i} className="text-[14.5px] text-stone-900 leading-snug">
                        <span className="mr-3">·</span>{s}
                      </p>
                    ))
                  ) : (
                    <p className="text-[12.5px] text-stone-300 italic">No services selected</p>
                  )}
                </div>

                {/* Service fee */}
                <p className="text-[14.5px] font-bold text-stone-900 mb-6">
                  EMRG Media Service Fee: {client.service_fee || "$__________"}
                </p>

                {/* Assistance clause */}
                <p className="text-[13.5px] text-stone-800 italic mb-6 leading-6">
                  ** Above is the General Event Scope. Should{" "}
                  <span className="font-semibold not-italic">{client.client_name || "_______________"}</span>{" "}
                  require additional assistance, parties can determine the rate for such services provided.
                </p>

                {/* Signing section */}
                <p className="text-[14.5px] text-stone-900 mb-5 leading-7">
                  By signing below I,{" "}
                  {client.signer_name
                    ? <span className="font-semibold">
                        {client.signer_name}{client.signer_title ? `, ${client.signer_title}` : ""}
                      </span>
                    : <span className="inline-block border-b border-stone-400 w-48 align-bottom" />},{" "}
                  am agreeing to hire EMRG Media LLC to handle the above event scope and event planning
                  details pertaining to the{" "}
                  {events.flatMap((e) => e.eventTypes).length > 0
                    ? <span className="font-semibold">{[...new Set(events.flatMap((e) => e.eventTypes))].join(" / ")}</span>
                    : <span className="inline-block border-b border-stone-400 w-24 align-bottom" />
                  }{" "}event.
                </p>

                {/* Signature blocks */}
                <div className="text-[13.5px] text-stone-900 space-y-2 mb-8">
                  <p>Company: {client.client_name
                    ? <span className="font-medium">{client.client_name}</span>
                    : <span className="inline-block border-b border-stone-400 w-64 align-bottom" />}</p>
                  <div className="flex gap-8">
                    <p>Name: {client.signer_name
                      ? <span className="font-medium">{client.signer_name}</span>
                      : <span className="inline-block border-b border-stone-400 w-36 align-bottom" />}</p>
                    <p>Signature: <span className="inline-block border-b border-stone-400 w-36 align-bottom" /></p>
                  </div>
                  <p>Date: <span className="inline-block border-b border-stone-400 w-24 align-bottom" /></p>
                  <div className="h-3" />
                  <p>Planning Agency: <span className="inline-block border-b border-stone-400 w-52 align-bottom" /></p>
                  <div className="flex gap-8">
                    <p>Name: <span className="inline-block border-b border-stone-400 w-36 align-bottom" /></p>
                    <p>Signature: <span className="inline-block border-b border-stone-400 w-36 align-bottom" /></p>
                  </div>
                  <p>Date: <span className="inline-block border-b border-stone-400 w-24 align-bottom" /></p>
                </div>

                {/* Address footer */}
                <div className="border-t border-stone-200 pt-4 text-center">
                  <p className="text-[13px] text-stone-800" style={{ fontFamily: "Georgia, serif" }}>
                    {EMRG_ADDRESS}
                  </p>
                </div>

              </div>
            </div>

            </div>
          )}
        </div>

      </div>

      {/* ── Email preview modal ── */}
      {emailModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6"
          style={{ background: "rgba(20,18,16,0.55)" }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setEmailModalOpen(false); }}>
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-7 py-5 border-b border-stone-200 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "#111111" }}>
                  Review email before sending
                </p>
                <p className="text-[13px] text-stone-500 mt-0.5">
                  To: <span className="font-semibold text-stone-800">{client.client_email}</span>
                  <span className="ml-3 text-stone-400">BCC: events@emrgmedia.com · Proposal PDF attached</span>
                </p>
              </div>
              <button onClick={() => setEmailModalOpen(false)}
                className="text-stone-400 hover:text-stone-700 text-xl leading-none px-1" aria-label="Close">×</button>
            </div>
            <div className="px-7 py-5 space-y-4 overflow-y-auto">
              <div>
                <FieldLabel>Subject</FieldLabel>
                <input type="text" value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)}
                  className="w-full border-2 border-stone-400 rounded-md px-4 py-2.5 text-[15px] bg-white text-stone-900" />
              </div>
              <div>
                <FieldLabel>Message</FieldLabel>
                <textarea value={emailBody} onChange={(e) => setEmailBody(e.target.value)}
                  rows={12}
                  className="w-full border-2 border-stone-400 rounded-md px-4 py-3 text-[15px] leading-relaxed bg-white text-stone-900 resize-y" />
              </div>
              {sendError && (
                <p className="text-[13px] font-semibold" style={{ color: "var(--emrg-red)" }}>{sendError}</p>
              )}
            </div>
            <div className="px-7 py-4 border-t border-stone-200 flex justify-end gap-3">
              <button onClick={() => setEmailModalOpen(false)}
                className="px-5 py-2.5 text-[13px] font-bold tracking-wider uppercase rounded-md border-2 border-stone-300 text-stone-600">
                Cancel
              </button>
              <button onClick={handleSendToClient} disabled={sending || !emailSubject.trim() || !emailBody.trim()}
                className="px-6 py-2.5 text-[13px] font-bold tracking-wider uppercase rounded-md text-white disabled:opacity-40"
                style={{ background: "var(--emrg-red)" }}>
                {sending ? "Sending…" : "Send Email"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PagePill({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-stone-500 !mb-2">{children}</p>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <div style={{ width: 2, height: 11, background: "var(--emrg-red)", borderRadius: 2 }} />
      <h2 className="text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "#111111" }}>{children}</h2>
    </div>
  );
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-[11px] font-bold tracking-[0.22em] uppercase mb-1.5" style={{ color: "#111111" }}>
      {children}
      {required && <span style={{ color: "var(--emrg-red)" }} className="ml-0.5"> *</span>}
    </label>
  );
}

function TextField({ label, name, value, onChange, placeholder, required }: {
  label: string; name: string; value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string; required?: boolean;
}) {
  return (
    <div>
      <FieldLabel required={required}>{label}</FieldLabel>
      <input type="text" name={name} value={value} onChange={onChange} placeholder={placeholder}
        className="w-full border-2 border-stone-400 rounded-md px-4 py-2.5 text-[16px] bg-white text-stone-900 placeholder-stone-400 transition-colors" />
    </div>
  );
}

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={onChange}
        className="mt-0.5 h-[15px] w-[15px] flex-shrink-0 rounded border-stone-300" />
      <span className="text-[16px] leading-snug transition-colors" style={{ color: "#111111" }}>{label}</span>
    </label>
  );
}
