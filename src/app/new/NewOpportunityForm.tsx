"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EVENT_TYPES, LEAD_SOURCES } from "@/lib/constants";
import { parseMoneyToCents } from "@/lib/fee";
import { checkCompleteness } from "@/lib/completeness";
import { createOpportunityAction } from "@/app/actions";
import VoiceCapture from "./VoiceCapture";

// Four ways in, one record out (brief §5). Transcript, voice and (later) email
// all land in the same draft form, which is then confirmed by a human — so the
// extraction is always reviewed before it becomes an opportunity.

type Mode = "transcript" | "voice" | "manual";

const EMPTY = {
  company: "", firstName: "", lastName: "", title: "", email: "", cellPhone: "",
  address: "", city: "", state: "", zip: "", website: "",
  leadSource: "", eventName: "", eventDate: "", guestCount: "", venue: "",
  budgetLow: "", budgetHigh: "", feeRaw: "", notes: "",
};

export default function NewOpportunityForm({ team, currentUserId }: {
  team: Array<{ id: string; name: string }>; currentUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [mode, setMode] = useState<Mode>("transcript");
  const [source, setSource] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState("");
  const [extracted, setExtracted] = useState(false);

  const [form, setForm] = useState(EMPTY);
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [ownerId, setOwnerId] = useState(currentUserId);
  const [collaborators, setCollaborators] = useState<string[]>([]);
  const [error, setError] = useState("");

  const set = (k: keyof typeof EMPTY) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  async function extract() {
    if (!source.trim() || extracting) return;
    setExtracting(true);
    setExtractError("");
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: source }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not read those notes.");

      setForm((f) => ({
        ...f,
        company: data.company || f.company,
        firstName: data.first_name || f.firstName,
        lastName: data.last_name || f.lastName,
        title: data.title || f.title,
        email: data.email || f.email,
        cellPhone: data.cell_phone || f.cellPhone,
        address: data.address || f.address,
        city: data.city || f.city,
        state: data.state || f.state,
        zip: data.zip || f.zip,
        website: data.website || f.website,
        leadSource: data.lead_source || f.leadSource,
        eventName: data.event_name || f.eventName,
        eventDate: data.event_date || f.eventDate,
        guestCount: data.guest_count || f.guestCount,
        venue: data.venue || f.venue,
        budgetLow: data.budget_low || f.budgetLow,
        budgetHigh: data.budget_high || f.budgetHigh,
        feeRaw: data.service_fee || f.feeRaw,
        notes: data.notes || f.notes,
      }));
      if (Array.isArray(data.event_types)) setEventTypes(normalizeTypes(data.event_types));
      if (Array.isArray(data.requested_services)) setServices(data.requested_services.filter(Boolean));
      setExtracted(true);
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : "Extraction failed.");
    } finally {
      setExtracting(false);
    }
  }

  function save() {
    setError("");
    startTransition(async () => {
      const res = await createOpportunityAction({
        company: form.company, firstName: form.firstName, lastName: form.lastName,
        title: form.title, email: form.email, cellPhone: form.cellPhone,
        address: form.address, city: form.city, state: form.state, zip: form.zip,
        website: form.website, leadSource: form.leadSource,
        eventName: form.eventName, eventTypes, eventDate: form.eventDate,
        guestCount: form.guestCount, venue: form.venue, requestedServices: services,
        notes: form.notes, feeRaw: form.feeRaw,
        budgetLowCents: parseMoneyToCents(form.budgetLow),
        budgetHighCents: parseMoneyToCents(form.budgetHigh),
        ownerId: ownerId || null,
        collaboratorIds: collaborators,
        rawIntake: source ? { mode, source } : {},
      });
      if (!res.ok) { setError(res.error); return; }
      router.push(`/opportunity/${res.id}`);
    });
  }

  // Same rules the opportunity screen uses, so a gap flagged here is the same
  // gap flagged later rather than a second opinion.
  const completeness = checkCompleteness({
    company: form.company, firstName: form.firstName, lastName: form.lastName,
    title: form.title, email: form.email, cellPhone: form.cellPhone,
    eventDate: form.eventDate, guestCount: form.guestCount, venue: form.venue,
    eventTypes, requestedServices: services, feeRaw: form.feeRaw,
    budgetLowCents: parseMoneyToCents(form.budgetLow),
    budgetHighCents: parseMoneyToCents(form.budgetHigh),
  });
  const canSave = !!(form.company.trim() || form.lastName.trim());

  return (
    <div className="px-5 md:px-8 py-6 max-w-[1100px] mx-auto">
      <h1 className="text-[22px] font-bold tracking-tight mb-1" style={{ color: "#111111" }}>
        New opportunity
      </h1>
      <p className="text-[13px] text-stone-500 mb-5">
        For a lead you want on the board before there is a proposal. If you are quoting now,
        go straight to <a href="/proposal" className="font-semibold underline"
        style={{ color: "var(--emrg-red)" }}>New Proposal</a> instead, which creates the
        opportunity for you.
      </p>

      <div className="flex items-center gap-1 bg-white border border-stone-200 rounded-lg p-1 w-fit mb-5">
        {([
          ["transcript", "Paste transcript"],
          ["voice", "Speak it"],
          ["manual", "Type it in"],
        ] as Array<[Mode, string]>).map(([m, label]) => (
          <button key={m} type="button" onClick={() => setMode(m)}
            className="px-4 py-1.5 text-[11px] font-bold tracking-[0.12em] uppercase rounded-md transition-colors"
            style={mode === m ? { background: "var(--emrg-black)", color: "#fff" } : { color: "#78716c" }}>
            {label}
          </button>
        ))}
      </div>

      {mode !== "manual" && (
        <div className="bg-white border-2 border-dashed border-stone-300 rounded-lg p-5 mb-6">
          {mode === "voice" ? (
            <VoiceCapture value={source} onChange={setSource} />
          ) : (
            <>
              <p className="text-[11px] font-bold tracking-[0.2em] uppercase mb-2" style={{ color: "#111111" }}>
                Transcript or notes
              </p>
              <textarea value={source} onChange={(e) => setSource(e.target.value)}
                placeholder="Paste the call transcript, your notes, or a forwarded enquiry email."
                className="w-full h-40 text-[14px] resize-none bg-transparent outline-none leading-relaxed text-stone-900 placeholder-stone-400" />
            </>
          )}

          {extractError && (
            <p className="text-[12.5px] mt-1" style={{ color: "var(--emrg-red)" }}>{extractError}</p>
          )}
          <div className="flex items-center justify-between gap-3 mt-3">
            <p className="text-[11.5px] text-stone-400">
              {extracted ? "Details filled in below. Check them before saving." : "Nothing is saved until you confirm."}
            </p>
            <button type="button" onClick={extract} disabled={!source.trim() || extracting}
              className="text-[10px] font-bold tracking-[0.16em] uppercase px-4 py-2 rounded text-white disabled:opacity-40 whitespace-nowrap"
              style={{ background: "var(--emrg-red)" }}>
              {extracting ? "Reading…" : "Pull out the details"}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white border border-stone-200 rounded-lg p-5 mb-5">
        <p className="text-[11px] font-bold tracking-[0.2em] uppercase mb-4" style={{ color: "#111111" }}>
          Contact
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          <Input label="Company" value={form.company} onChange={set("company")} />
          <Select label="Lead source" value={form.leadSource} onChange={set("leadSource")}
            options={LEAD_SOURCES} />
          <Input label="First name" value={form.firstName} onChange={set("firstName")} />
          <Input label="Last name" value={form.lastName} onChange={set("lastName")} />
          <Input label="Title" value={form.title} onChange={set("title")} />
          <Input label="Email" value={form.email} onChange={set("email")} type="email"
            placeholder="name@company.com" highlight={!form.email.trim()} />
          <Input label="Cell phone" value={form.cellPhone} onChange={set("cellPhone")} />
          <Input label="Website" value={form.website} onChange={set("website")} />
          <Input label="Address" value={form.address} onChange={set("address")} />
          <Input label="City" value={form.city} onChange={set("city")} />
          <Input label="State" value={form.state} onChange={set("state")} />
          <Input label="ZIP" value={form.zip} onChange={set("zip")} />
        </div>
      </div>

      <div className="bg-white border border-stone-200 rounded-lg p-5 mb-5">
        <p className="text-[11px] font-bold tracking-[0.2em] uppercase mb-4" style={{ color: "#111111" }}>
          Event
        </p>
        <div className="grid sm:grid-cols-2 gap-3 mb-4">
          <Input label="Event name" value={form.eventName} onChange={set("eventName")}
            placeholder="Google Holiday Party" />
          <Input label="Event date" value={form.eventDate} onChange={set("eventDate")}
            placeholder="December 14, 2026" />
          <Input label="Guest count" value={form.guestCount} onChange={set("guestCount")} placeholder="200" />
          <Input label="Venue" value={form.venue} onChange={set("venue")} placeholder="TBD" />
          <Input label="Budget low" value={form.budgetLow} onChange={set("budgetLow")} placeholder="$50,000" />
          <Input label="Budget high" value={form.budgetHigh} onChange={set("budgetHigh")} placeholder="$75,000" />
          <div className="sm:col-span-2">
            <Input label="Fee (a figure, a range, or a percentage)" value={form.feeRaw}
              onChange={set("feeRaw")} placeholder="$12,000 or 20%" />
          </div>
        </div>

        <Chips label="Event type" all={EVENT_TYPES} selected={eventTypes} onToggle={(t) =>
          setEventTypes((s) => s.includes(t) ? s.filter((x) => x !== t) : [...s, t])} />

        {services.length > 0 && (
          <div className="mt-4">
            <p className="text-[10px] font-bold tracking-[0.14em] uppercase text-stone-500 mb-1.5">
              Requested services
            </p>
            <div className="flex flex-wrap gap-1.5">
              {services.map((s) => (
                <span key={s} className="px-2.5 py-1 rounded text-[12px] border border-stone-300 text-stone-600">
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4">
          <label className="block text-[10px] font-bold tracking-[0.14em] uppercase text-stone-500 mb-1.5">Notes</label>
          <textarea value={form.notes} onChange={set("notes")}
            className="w-full h-20 border-2 border-stone-300 rounded-md px-3 py-2 text-[14px] bg-white resize-none" />
        </div>
      </div>

      <div className="bg-white border border-stone-200 rounded-lg p-5 mb-5">
        <p className="text-[11px] font-bold tracking-[0.2em] uppercase mb-4" style={{ color: "#111111" }}>
          Who owns it
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-bold tracking-[0.14em] uppercase text-stone-500 mb-1.5">
              Primary owner
            </label>
            <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}
              className="w-full border-2 border-stone-300 rounded-md px-3 py-2 text-[14px] bg-white">
              <option value="">Unassigned</option>
              {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold tracking-[0.14em] uppercase text-stone-500 mb-1.5">
              Collaborators
            </label>
            <div className="flex flex-wrap gap-1.5">
              {team.filter((m) => m.id !== ownerId).map((m) => {
                const on = collaborators.includes(m.id);
                return (
                  <button key={m.id} type="button"
                    onClick={() => setCollaborators((c) => on ? c.filter((x) => x !== m.id) : [...c, m.id])}
                    className="px-2.5 py-1 rounded text-[12px] font-medium border transition-colors"
                    style={on
                      ? { borderColor: "var(--emrg-red)", background: "rgba(192,24,42,0.06)", color: "#111" }
                      : { borderColor: "#d6d3d1", background: "#fff", color: "#78716c" }}>
                    {m.name.split(" ")[0]}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {completeness.missing.length > 0 && (
        <div className="mb-4 px-4 py-2.5 rounded-lg border text-[13px]"
          style={{ background: "#fdf6e9", borderColor: "#e7d3a6", color: "#7a5309" }}>
          {completeness.blocking.length > 0 && (
            <p className="mb-1">
              <strong>Needed before a proposal can go out:</strong>{" "}
              {completeness.blocking.map((m) => m.label.toLowerCase()).join(", ")}.
            </p>
          )}
          {completeness.important.length > 0 && (
            <p>
              Still missing: {completeness.important.map((m) => m.label.toLowerCase()).join(", ")}.
              {" "}You can save now and fill these in later.
            </p>
          )}
          {!canSave && <p className="mt-1">A company or contact name is needed to save.</p>}
        </div>
      )}
      {error && (
        <div className="mb-4 px-4 py-2.5 rounded-lg border text-[13px]"
          style={{ background: "#fef2f2", borderColor: "#fecaca", color: "#991b1b" }}>
          {error}
        </div>
      )}

      <div className="flex items-center gap-3 pb-10">
        <button type="button" onClick={save} disabled={pending || !canSave}
          className="text-[11px] font-bold tracking-[0.16em] uppercase px-5 py-2.5 rounded text-white disabled:opacity-40"
          style={{ background: "var(--emrg-red)" }}>
          {pending ? "Saving…" : "Create opportunity"}
        </button>
        <button type="button" onClick={() => router.push("/")}
          className="text-[11px] font-bold tracking-[0.14em] uppercase px-3 py-2.5 text-stone-500">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Inputs ───────────────────────────────────────────────────────────────────

function Input({ label, value, onChange, placeholder, type = "text", highlight }: {
  label: string; value: string; placeholder?: string; type?: string; highlight?: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div>
      <label className="block text-[10px] font-bold tracking-[0.14em] uppercase text-stone-500 mb-1.5">
        {label}
      </label>
      <input type={type} value={value} onChange={onChange} placeholder={placeholder}
        className="w-full border-2 rounded-md px-3 py-2 text-[14px] bg-white"
        style={{ borderColor: highlight ? "#e7d3a6" : "#d6d3d1" }} />
    </div>
  );
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; options: string[];
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
}) {
  return (
    <div>
      <label className="block text-[10px] font-bold tracking-[0.14em] uppercase text-stone-500 mb-1.5">
        {label}
      </label>
      <select value={value} onChange={onChange}
        className="w-full border-2 border-stone-300 rounded-md px-3 py-2 text-[14px] bg-white">
        <option value="">Select...</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
        {value && !options.includes(value) && <option value={value}>{value}</option>}
      </select>
    </div>
  );
}

function Chips({ label, all, selected, onToggle }: {
  label: string; all: string[]; selected: string[]; onToggle: (t: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // Anything already selected must always be visible, even when it sits far
  // down the list or came back from an extraction as a custom label —
  // otherwise a correct extraction looks like it silently failed.
  const extra = selected.filter((s) => !all.includes(s));
  const visible = open
    ? [...new Set([...all, ...extra])]
    : [...new Set([...selected, ...all.slice(0, 10)])];
  const hiddenCount = all.length + extra.length - visible.length;

  return (
    <div>
      <label className="block text-[10px] font-bold tracking-[0.14em] uppercase text-stone-500 mb-1.5">
        {label}
      </label>
      <div className="flex flex-wrap gap-1.5">
        {visible.map((t) => {
          const on = selected.includes(t);
          return (
            <button key={t} type="button" onClick={() => onToggle(t)}
              className="px-2.5 py-1 rounded text-[12px] font-medium border transition-colors"
              style={on
                ? { borderColor: "var(--emrg-red)", background: "rgba(192,24,42,0.06)", color: "#111" }
                : { borderColor: "#d6d3d1", background: "#fff", color: "#78716c" }}>
              {t}
            </button>
          );
        })}
        {(open || hiddenCount > 0) && (
          <button type="button" onClick={() => setOpen((o) => !o)}
            className="px-2.5 py-1 rounded text-[12px] font-semibold" style={{ color: "var(--emrg-red)" }}>
            {open ? "Show fewer" : `+${hiddenCount} more`}
          </button>
        )}
      </div>
    </div>
  );
}

/** Match free text to the canonical list, Title Case the rest, dedupe. */
function normalizeTypes(types: string[]): string[] {
  const out: string[] = [];
  for (const raw of types) {
    const t = String(raw).trim();
    if (!t) continue;
    const canonical = EVENT_TYPES.find((e) => e.toLowerCase() === t.toLowerCase());
    const value = canonical ?? t.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1));
    if (!out.some((x) => x.toLowerCase() === value.toLowerCase())) out.push(value);
  }
  return out;
}
