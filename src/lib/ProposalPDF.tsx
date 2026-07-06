import {
  Document, Page, Text, View, Image, StyleSheet, Font,
} from "@react-pdf/renderer";
import { createElement } from "react";

// Use built-in PDF fonts — no network dependency


const C = {
  red: "#c0182a",
  black: "#111111",
  gray: "#57534e",
  lightGray: "#a8a29e",
  border: "#9ca3af",
  bg: "#fafaf9",
};

const s = StyleSheet.create({
  page: { paddingHorizontal: 48, paddingVertical: 44, fontFamily: "Times-Roman", fontSize: 10.5, color: C.black, backgroundColor: "#ffffff" },
  logo: { width: 160, marginHorizontal: "auto", marginBottom: 22 },
  para: { lineHeight: 1.7, marginBottom: 10, fontSize: 10.5 },
  bold: { fontFamily: "Times-Bold" },
  italic: { fontFamily: "Times-Italic" },
  // Table
  table: { marginBottom: 14 },
  row: { flexDirection: "row" },
  thCell: { borderWidth: 0.75, borderColor: C.border, paddingHorizontal: 8, paddingVertical: 5, backgroundColor: C.bg, fontFamily: "Times-Bold", fontSize: 10 },
  tdCell: { borderWidth: 0.75, borderColor: C.border, paddingHorizontal: 8, paddingVertical: 5, fontSize: 10 },
  // Responsibilities
  sectionTitle: { fontFamily: "Times-Bold", marginBottom: 6, fontSize: 10.5 },
  bullet: { flexDirection: "row", marginBottom: 3 },
  dot: { width: 14, fontSize: 10.5 },
  bulletText: { flex: 1, fontSize: 10.5, lineHeight: 1.5 },
  // Signing
  signingPara: { lineHeight: 1.7, marginBottom: 16, fontSize: 10.5 },
  sigRow: { flexDirection: "row", alignItems: "flex-end", gap: 28, marginBottom: 16 },
  sigItem: { flexDirection: "row", alignItems: "flex-end" },
  sigLabel: { fontSize: 10.5, color: C.black },
  sigLine: { borderBottomWidth: 0.75, borderColor: C.border, height: 14, marginLeft: 6 },
  sigValue: { fontSize: 10.5, marginLeft: 6 },
  // Footer
  footer: { borderTopWidth: 0.75, borderColor: "#e7e5e4", paddingTop: 10, marginTop: 6, textAlign: "center", fontSize: 9, color: C.lightGray },
  // Spacer
  spacer: { height: 8 },
});

export interface ProposalData {
  client_name: string;
  signer_name?: string;
  signer_title?: string;
  budget_low: string;
  budget_high: string;
  service_fee: string;
  events: Array<{ date: string; eventTypes: string[]; guestCount: string; guestCountFormatted: string }>;
  selectedServices: string[];
  logoBase64: string;
}

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const EMRG_ADDRESS = "EMRG Media, 60 Sutton Place South, Suite 8LS  New York NY 10022  |  212.254.3700";

function parseDateParts(raw: string): { month: number; day: number; year: number } | null {
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
  const nameMatch = trimmed.match(/^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:[,\s]+(\d{2,4}))?$/) ||
    trimmed.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]+)\.?(?:[,\s]+(\d{2,4}))?$/);
  if (nameMatch) {
    const monthStr = /^\d/.test(nameMatch[1]) ? nameMatch[2] : nameMatch[1];
    const dayStr = /^\d/.test(nameMatch[1]) ? nameMatch[1] : nameMatch[2];
    const y = nameMatch[3];
    const month = MONTHS.findIndex((m) => m.toLowerCase().startsWith(monthStr.toLowerCase().slice(0, 3)));
    const day = parseInt(dayStr);
    const year = !y ? currentYear : y.length === 2 ? 2000 + parseInt(y) : parseInt(y);
    if (month >= 0 && day >= 1 && day <= 31) return { month, day, year };
  }
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) {
    // JS parses year-less dates into garbage years — override with current year
    const year = /\b(19|20)\d{2}\b/.test(trimmed) ? d.getFullYear() : currentYear;
    return { month: d.getMonth(), day: d.getDate(), year };
  }
  return null;
}

function ordinal(day: number): string {
  return [11,12,13].includes(day % 100) ? "th" : day % 10 === 1 ? "st" : day % 10 === 2 ? "nd" : day % 10 === 3 ? "rd" : "th";
}

function formatDateLong(raw: string): string {
  const p = parseDateParts(raw);
  if (!p) return raw;
  return `${MONTHS[p.month]} ${p.day}${ordinal(p.day)}, ${p.year}`;
}

// Cover style: "December 10, 2026" (no ordinal)
function formatDatePlain(raw: string): string {
  const p = parseDateParts(raw);
  if (!p) return raw;
  return `${MONTHS[p.month]} ${p.day}, ${p.year}`;
}

// Letter style: "December 10th" (no year)
function formatDateOrdinalNoYear(raw: string): string {
  const p = parseDateParts(raw);
  if (!p) return raw;
  return `${MONTHS[p.month]} ${p.day}${ordinal(p.day)}`;
}

function formatGuestCount(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const rangeMatch = trimmed.match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (rangeMatch) return `${parseInt(rangeMatch[1]).toLocaleString()}-${parseInt(rangeMatch[2]).toLocaleString()} ppl`;
  const digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return trimmed + " ppl";
  return parseInt(digits).toLocaleString() + " ppl";
}

export function ProposalPDF({ data }: { data: ProposalData }) {
  const { client_name, signer_name, signer_title, budget_low, budget_high, service_fee, events, selectedServices, logoBase64 } = data;
  const multipleEvents = events.length > 1;
  const allEventTypes = [...new Set(events.flatMap((e) => e.eventTypes))];

  const budgetText = budget_low || budget_high
    ? [budget_low, budget_high].filter(Boolean).join(" to ")
    : "$_______ _______";

  const firstEvent = events[0];
  const eventTypeLabel = allEventTypes.join(" / ") || "event";
  const signerFirstName = (signer_name || "").trim().split(/\s+/)[0] || "";
  const guestLabel = firstEvent?.guestCount
    ? (firstEvent.guestCountFormatted || formatGuestCount(firstEvent.guestCount)).replace(/\s*ppl$/, "")
    : "";

  return (
    <Document>

      {/* ── Page 1: Cover ── */}
      <Page size="LETTER" style={[s.page, { justifyContent: "center" }]}>
        <View style={{ alignItems: "center" }}>
          <Image src={`data:image/png;base64,${logoBase64}`} style={{ width: 220, marginBottom: 48 }} />
          <Text style={{ fontSize: 12, color: C.gray, marginBottom: 10, letterSpacing: 2 }}>PREPARED FOR</Text>
          <Text style={{ fontSize: 26, fontFamily: "Times-Bold", marginBottom: 16 }}>
            {client_name || "_______________"}
          </Text>
          <Text style={{ fontSize: 13, color: C.gray }}>
            {eventTypeLabel !== "event" ? eventTypeLabel : ""}
            {eventTypeLabel !== "event" && firstEvent?.date ? "  |  " : ""}
            {firstEvent?.date ? formatDatePlain(firstEvent.date) : ""}
          </Text>
          <View style={{ width: 40, height: 2, backgroundColor: C.red, marginTop: 28 }} />
        </View>
      </Page>

      {/* ── Page 2: Intro letter ── */}
      <Page size="LETTER" style={s.page}>
        <Image src={`data:image/png;base64,${logoBase64}`} style={s.logo} />
        <View style={{ marginTop: 18 }}>
          <Text style={s.para}>Dear {signerFirstName || "_________"},</Text>
          <Text style={s.para}>
            {"Thank you for the opportunity to plan "}
            <Text style={s.bold}>{client_name || "your company"}</Text>
            {"'s upcoming "}
            {eventTypeLabel !== "event" ? eventTypeLabel.toLowerCase() : "event"}
            {". For over 25 years, EMRG Media has produced more than 1,100 events for clients including JPMorgan, Netflix, Bloomberg and Condé Nast, and we would be honored to add this celebration to that list."}
          </Text>
          <Text style={s.para}>
            {"Enclosed is our proposed scope of services and agreement for your "}
            {firstEvent?.date ? <Text style={s.bold}>{formatDateOrdinalNoYear(firstEvent.date)}</Text> : "upcoming"}
            {" event"}
            {guestLabel ? ` for ${guestLabel} guests` : ""}
            {". Our team handles every detail from venue through day of execution, so your team enjoys the night instead of running it."}
          </Text>
          <Text style={s.para}>We look forward to creating something exceptional together.</Text>
          <View style={{ marginTop: 22 }}>
            <Text style={s.para}>Warm regards,</Text>
            <Text style={[s.bold, { fontSize: 10.5 }]}>Mario Stewart</Text>
            <Text style={{ fontSize: 10, color: C.gray }}>Founder and CEO, EMRG Media</Text>
            <Text style={{ fontSize: 10, color: C.gray }}>212.254.3700</Text>
          </View>
        </View>
        <Text style={[s.footer, { marginTop: "auto" }]}>{EMRG_ADDRESS}</Text>
      </Page>

      {/* ── Page 3+: Agreement ── */}
      <Page size="LETTER" style={s.page}>

        {/* Logo */}
        <Image src={`data:image/png;base64,${logoBase64}`} style={s.logo} />

        {/* Intro paragraphs */}
        <Text style={s.para}>
          {"EMRG Media agrees to act as the event planner to coordinate the upcoming event for "}
          <Text style={s.bold}>{client_name || "_______________"}</Text>
          {". EMRG Media will facilitate all related event planning needs and as outlined below."}
        </Text>

        <Text style={s.para}>
          {"The parties have discussed a general event overview including an estimated working event budget of "}
          <Text style={s.bold}>{budgetText}</Text>
          {". EMRG Media agrees to work within the parameters of the proposed budget."}
        </Text>

        <Text style={s.para}>
          {"EMRG Media, LLC will be paid an event management and planning fee of "}
          <Text style={s.bold}>{service_fee || "$________"}</Text>
          {" for the services outlined below in: Event Planner, Event Management and Production Responsibilities."}
        </Text>

        {/* Client + Events table */}
        <View style={s.table}>
          {/* Client row */}
          <View style={s.row}>
            <View style={[s.tdCell, { width: 90, fontFamily: "Times-Bold", backgroundColor: C.bg }]}>
              <Text>Client:</Text>
            </View>
            <View style={[s.tdCell, { flex: 1 }]}>
              <Text>{client_name || "_______________"}</Text>
            </View>
          </View>

          {/* Events header */}
          <View style={s.row}>
            <View style={[s.thCell, { flex: 1 }]}>
              <Text>{multipleEvents ? "Event Dates:" : "Preferred Date:"}</Text>
            </View>
            <View style={[s.thCell, { flex: 1 }]}>
              <Text>{multipleEvents ? "Event Types:" : "Event Type:"}</Text>
            </View>
            <View style={[s.thCell, { flex: 1 }]}>
              <Text>{multipleEvents ? "Estimated Guest Counts:" : "Estimated Guest Count:"}</Text>
            </View>
          </View>

          {/* Events data */}
          {multipleEvents ? (
            <View style={s.row}>
              <View style={[s.tdCell, { flex: 1 }]}>
                {events.map((ev, i) => (
                  <Text key={i} style={{ marginBottom: 2 }}>
                    {formatDateLong(ev.date) || "___"}
                  </Text>
                ))}
              </View>
              <View style={[s.tdCell, { flex: 1 }]}>
                {events.map((ev, i) => (
                  <Text key={i} style={{ marginBottom: 2 }}>
                    {ev.eventTypes.join(", ") || "___"}
                  </Text>
                ))}
              </View>
              <View style={[s.tdCell, { flex: 1 }]}>
                {events.map((ev, i) => {
                  const dateLabel = ev.date ? formatDateLong(ev.date).split(",")[0] : null;
                  const count = ev.guestCountFormatted || (ev.guestCount ? formatGuestCount(ev.guestCount) : "");
                  return (
                    <Text key={i} style={{ marginBottom: 2 }}>
                      {dateLabel ? <Text style={s.bold}>{dateLabel}: </Text> : null}{count || "___"}
                    </Text>
                  );
                })}
              </View>
            </View>
          ) : (
            <View style={s.row}>
              <View style={[s.tdCell, { flex: 1 }]}>
                <Text>{formatDateLong(events[0]?.date) || "_______________"}</Text>
              </View>
              <View style={[s.tdCell, { flex: 1 }]}>
                <Text>{events[0]?.eventTypes.join(", ") || "_______________"}</Text>
              </View>
              <View style={[s.tdCell, { flex: 1 }]}>
                <Text>{events[0]?.guestCountFormatted || (events[0]?.guestCount ? formatGuestCount(events[0].guestCount) : "_______________")}</Text>
              </View>
            </View>
          )}
        </View>

        {/* Responsibilities */}
        <Text style={s.sectionTitle}>
          EMRG Media Event Planner, Event Management and Production Responsibilities:
        </Text>
        {selectedServices.map((svc, i) => (
          <View key={i} style={s.bullet}>
            <Text style={s.dot}>·</Text>
            <Text style={s.bulletText}>{svc}</Text>
          </View>
        ))}

        <View style={s.spacer} />

        {/* Service fee */}
        <Text style={[s.sectionTitle, { marginTop: 4 }]}>
          EMRG Media Service Fee: {service_fee || "$__________"}
        </Text>

        {/* Assistance clause */}
        <Text style={[s.para, s.italic, { fontSize: 9.5, color: C.gray, marginTop: 2 }]}>
          {"** Above is the General Event Scope. Should "}
          <Text style={s.bold}>{client_name || "_______________"}</Text>
          {" require additional assistance, parties can determine the rate for such services provided."}
        </Text>

        {/* Signing — kept together: if it doesn't fit, the whole section moves to the next page */}
        <View wrap={false}>
          <Text style={s.signingPara}>
            {"By signing below I, "}
            {signer_name
              ? <Text style={s.bold}>{signer_name}{signer_title ? `, ${signer_title}` : ""}</Text>
              : <Text>{"_".repeat(28)}</Text>}
            {", am agreeing to hire EMRG Media LLC to handle the above event scope and event planning details pertaining to the "}
            <Text style={s.bold}>{allEventTypes.length > 0 ? allEventTypes.join(" / ") : "_".repeat(20)}</Text>
            {" event."}
          </Text>

          {/* Client signature block */}
          <View style={s.sigRow}>
            <View style={s.sigItem}>
              <Text style={s.sigLabel}>Company:</Text>
              {client_name
                ? <Text style={s.sigValue}>{client_name}</Text>
                : <View style={[s.sigLine, { width: 220 }]} />}
            </View>
          </View>
          <View style={s.sigRow}>
            <View style={s.sigItem}>
              <Text style={s.sigLabel}>Name:</Text>
              {signer_name
                ? <Text style={s.sigValue}>{signer_name}</Text>
                : <View style={[s.sigLine, { width: 150 }]} />}
            </View>
            <View style={s.sigItem}>
              <Text style={s.sigLabel}>Signature:</Text>
              <View style={[s.sigLine, { width: 150 }]} />
            </View>
            <View style={s.sigItem}>
              <Text style={s.sigLabel}>Date:</Text>
              <View style={[s.sigLine, { width: 90 }]} />
            </View>
          </View>

          <View style={{ height: 10 }} />

          {/* EMRG signature block */}
          <View style={s.sigRow}>
            <View style={s.sigItem}>
              <Text style={s.sigLabel}>Planning Agency:</Text>
              <Text style={s.sigValue}>EMRG Media, LLC</Text>
            </View>
          </View>
          <View style={s.sigRow}>
            <View style={s.sigItem}>
              <Text style={s.sigLabel}>Name:</Text>
              <View style={[s.sigLine, { width: 150 }]} />
            </View>
            <View style={s.sigItem}>
              <Text style={s.sigLabel}>Signature:</Text>
              <View style={[s.sigLine, { width: 150 }]} />
            </View>
            <View style={s.sigItem}>
              <Text style={s.sigLabel}>Date:</Text>
              <View style={[s.sigLine, { width: 90 }]} />
            </View>
          </View>
        </View>

        {/* Footer */}
        <Text style={s.footer}>{EMRG_ADDRESS}</Text>

      </Page>
    </Document>
  );
}

export function buildProposalDocument(data: ProposalData) {
  return createElement(ProposalPDF, { data });
}
