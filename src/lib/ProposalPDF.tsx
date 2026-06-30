import {
  Document, Page, Text, View, Image, StyleSheet, Font,
} from "@react-pdf/renderer";

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
  signingPara: { lineHeight: 1.7, marginBottom: 14, fontSize: 10.5 },
  sigLine: { borderBottomWidth: 0.75, borderColor: C.border, width: 180, marginBottom: 1 },
  sigLabel: { fontSize: 10, color: C.gray, marginBottom: 6 },
  sigRow: { flexDirection: "row", gap: 24, marginBottom: 6 },
  sigBlock: { marginBottom: 8 },
  // Footer
  footer: { borderTopWidth: 0.75, borderColor: "#e7e5e4", paddingTop: 10, marginTop: 6, textAlign: "center", fontSize: 9, color: C.lightGray },
  // Spacer
  spacer: { height: 8 },
});

export interface ProposalData {
  client_name: string;
  budget_low: string;
  budget_high: string;
  service_fee: string;
  events: Array<{ date: string; eventTypes: string[]; guestCount: string; guestCountFormatted: string }>;
  selectedServices: string[];
  logoBase64: string;
}

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const EMRG_ADDRESS = "EMRG Media, 60 Sutton Place South, Suite 8LS  New York NY 10022  |  212.254.3700";

function formatDateLong(raw: string): string {
  if (!raw.trim()) return "";
  const normalised = raw.trim().replace(/\//g, "-");
  const mdyMatch = normalised.match(/^(\d{1,2})[- .](\d{1,2})[- .](\d{2,4})$/);
  if (mdyMatch) {
    const [, a, b, y] = mdyMatch;
    const year = y.length === 2 ? 2000 + parseInt(y) : parseInt(y);
    const month = parseInt(a) - 1;
    const day = parseInt(b);
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      const suffix = [11,12,13].includes(day % 100) ? "th" : day % 10 === 1 ? "st" : day % 10 === 2 ? "nd" : day % 10 === 3 ? "rd" : "th";
      return `${MONTHS[month]} ${day}${suffix}, ${year}`;
    }
  }
  const d = new Date(raw);
  if (!isNaN(d.getTime())) {
    const day = d.getDate();
    const suffix = [11,12,13].includes(day % 100) ? "th" : day % 10 === 1 ? "st" : day % 10 === 2 ? "nd" : day % 10 === 3 ? "rd" : "th";
    return `${MONTHS[d.getMonth()]} ${day}${suffix}, ${d.getFullYear()}`;
  }
  return raw;
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
  const { client_name, budget_low, budget_high, service_fee, events, selectedServices, logoBase64 } = data;
  const multipleEvents = events.length > 1;
  const allEventTypes = [...new Set(events.flatMap((e) => e.eventTypes))];

  const budgetText = budget_low || budget_high
    ? [budget_low, budget_high].filter(Boolean).join(" to ")
    : "$_______ _______";

  return (
    <Document>
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

        {/* Signing */}
        <Text style={s.signingPara}>
          {"By signing below I, "}
          <Text>{"_".repeat(28)}</Text>
          {", am agreeing to hire EMRG Media LLC to handle the above event scope and event planning details pertaining to the "}
          <Text style={s.bold}>{allEventTypes.length > 0 ? allEventTypes.join(" / ") : "_".repeat(20)}</Text>
          {" event."}
        </Text>

        {/* Signature blocks */}
        <View style={{ opacity: 0.55 }}>
          <View style={s.sigBlock}>
            <Text style={s.sigLabel}>Company:</Text>
            <View style={s.sigLine} />
          </View>
          <View style={s.sigRow}>
            <View style={s.sigBlock}>
              <Text style={s.sigLabel}>Name:</Text>
              <View style={[s.sigLine, { width: 130 }]} />
            </View>
            <View style={s.sigBlock}>
              <Text style={s.sigLabel}>Signature:</Text>
              <View style={[s.sigLine, { width: 130 }]} />
            </View>
          </View>
          <View style={[s.sigBlock, { marginBottom: 16 }]}>
            <Text style={s.sigLabel}>Date:</Text>
            <View style={[s.sigLine, { width: 90 }]} />
          </View>

          <View style={s.sigBlock}>
            <Text style={s.sigLabel}>Planning Agency:</Text>
            <View style={[s.sigLine, { width: 200 }]} />
          </View>
          <View style={s.sigRow}>
            <View style={s.sigBlock}>
              <Text style={s.sigLabel}>Name:</Text>
              <View style={[s.sigLine, { width: 130 }]} />
            </View>
            <View style={s.sigBlock}>
              <Text style={s.sigLabel}>Signature:</Text>
              <View style={[s.sigLine, { width: 130 }]} />
            </View>
          </View>
          <View style={s.sigBlock}>
            <Text style={s.sigLabel}>Date:</Text>
            <View style={[s.sigLine, { width: 90 }]} />
          </View>
        </View>

        {/* Footer */}
        <Text style={s.footer}>{EMRG_ADDRESS}</Text>

      </Page>
    </Document>
  );
}
