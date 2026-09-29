import {
  Document, Page, Text, View, Image, StyleSheet,
} from "@react-pdf/renderer";
import { computeFee, fmtMoney } from "@/lib/fee";

// The Event Planning Agreement, rebuilt from EMRG's own Carbon Direct Capital
// document. Erica sends this alongside the scope, or on its own once a client
// has approved the scope, so it is a separate document rather than another
// page of the proposal.
//
// Most of it is fixed: the responsibilities paragraph, the vendor clause and
// the force majeure and cancellation terms are contract language and are
// reproduced verbatim. What varies per client is the opening paragraph, the
// fee, the two payments and the budget range, which is exactly what Erica
// flagged as "stuff we have to change automatically per each one".

const C = {
  black: "#111111",
  border: "#9ca3af",
  lightGray: "#a8a29e",
};

const s = StyleSheet.create({
  page: { paddingHorizontal: 48, paddingVertical: 44, fontFamily: "Times-Roman", fontSize: 10.5, color: C.black, backgroundColor: "#ffffff" },
  logo: { width: 160, marginHorizontal: "auto", marginBottom: 18 },
  title: { fontFamily: "Times-Bold", fontSize: 11.5, textAlign: "center", marginBottom: 16 },
  para: { lineHeight: 1.35, marginBottom: 11, fontSize: 10.5, textAlign: "justify" as const },
  bold: { fontFamily: "Times-Bold" },
  sigBlock: { flexDirection: "row", marginTop: 18, gap: 36 },
  sigCol: { flex: 1 },
  sigLabel: { fontSize: 10.5, marginBottom: 14 },
  sigLine: { borderBottomWidth: 0.75, borderColor: C.border, height: 13, marginBottom: 14 },
  sigField: { flexDirection: "row", alignItems: "flex-end", marginBottom: 14 },
  sigFieldLabel: { fontSize: 10.5 },
  sigFieldLine: { borderBottomWidth: 0.75, borderColor: C.border, flex: 1, height: 13, marginLeft: 4 },
  footer: { position: "absolute", bottom: 32, left: 48, right: 48, textAlign: "center", fontSize: 9, color: C.lightGray },
});

export interface AgreementData {
  client_name: string;
  /** The legal shorthand: "Carbon Direct Capital (referred to as Carbon)". */
  short_name: string;
  signer_name: string;
  signer_title: string;
  client_address: string;
  /** e.g. "investor event", lowercase, as it reads mid-sentence. */
  event_descriptor: string;
  /** e.g. "NYC" or a named venue. */
  location: string;
  /** e.g. "2026, exact date TBD" or "on March 12, 2027". */
  timing: string;
  service_fee: string;
  budget_low: string;
  budget_high: string;
  /** Due on signing. Defaults to half the fee. */
  deposit_first: string;
  /** Due before the event. Defaults to half the fee. */
  deposit_second: string;
  logoBase64?: string;
}

const EMRG_FOOTER =
  "EMRG Media LLC, 60 Sutton Place South, Suite 8LS New York NY 10022 | 212.254.3700";

export function AgreementPDF({ data }: { data: AgreementData }) {
  const {
    client_name, short_name, signer_name, signer_title, client_address,
    event_descriptor, location, timing, service_fee,
    budget_low, budget_high, deposit_first, deposit_second, logoBase64,
  } = data;

  const client = client_name || "__________";
  const short = short_name || client;
  const budgetText = [budget_low, budget_high].filter(Boolean).join("- ") || "$________";

  // The signed figure must be a number, never a rate, for the same reason it
  // is on the scope.
  const resolved = computeFee(service_fee, [budget_low, budget_high].filter(Boolean).join(" to "));
  const feeText = resolved.value !== null ? fmtMoney(resolved.value) : (service_fee || "$________");

  const who = [signer_name, signer_title].filter(Boolean).join(", ");

  return (
    <Document>
      <Page size="LETTER" style={s.page}>
        {logoBase64 && <Image style={s.logo} src={`data:image/png;base64,${logoBase64}`} />}

        <Text style={s.title}>Agreement for the {client}</Text>

        <Text style={s.para}>
          {who || "__________"}{client_address ? ` at ${client}, ${client_address}` : ` at ${client}`}
          {" "}(referred to as {short}) the customer and EMRG Media LLC, (referred to as
          {" "}&quot;EMRG&quot;) the event planner hereby contracts for {article(event_descriptor)}
          {" "}{event_descriptor || "event"} (the event) to take place at a venue in
          {" "}{location || "NYC"} {timing || "exact date TBD"}.
        </Text>

        <Text style={s.para}>
          EMRG agrees to act as the event planner to handle the following needs to include venue
          sourcing, venue management, venue negotiating, menu selection, rental needs, floor plan
          layout and design, AV and tech, facilitate and manage day of needs to include set up and
          breakdown, floral, vendor management, registration, and other event planning needs.
          Should the client want additional event elements planner can provide such services for an
          additional cost.
        </Text>

        <Text style={s.para}>
          {short} agrees to execute such contracts with the selected vendors including the chosen
          venue, staff, entertainment, rentals, AV/ Tech, gifting items, photographer, décor, and
          any other related event needs that may be required.
        </Text>

        <Text style={s.para}>
          The parties have discussed a general event overview for the event to begin the event
          planning process. EMRG Media, LLC will be paid an event planning fee of{" "}
          <Text style={s.bold}>{feeText}</Text>. An initial non-refundable deposit payment of{" "}
          <Text style={s.bold}>{deposit_first || "$________"}</Text> shall be made to EMRG upon
          signing of the contract, another payment of{" "}
          <Text style={s.bold}>{deposit_second || "$________"}</Text> paid 14 business days prior
          to the event date. Parties have put together an estimated event cost ranging from{" "}
          <Text style={s.bold}>{budgetText}</Text>. Once the venue is selected {short} will
          initiate event related payments.
        </Text>

        <Text style={s.para}>
          Neither party shall be liable in damages nor have the right to terminate this agreement
          for any delay or default in performing hereunder if such delay or default is caused by
          conditions beyond its control including, but not limited to Acts of God, natural
          disasters, government restrictions, wars, terrorism, insurrections, fire, failure of
          vendors, labor strikes, and/or any other cause beyond the reasonable control of the party
          whose performance is affected. Should client cancel the event completely, with a 3-month
          notice, client will forfeit their initial deposit but will not be required to pay the
          balance of the event planning fee. If the client cancels said event with less than a
          3-month notice the client will be required to pay the full event planning fee. In this
          case, planner will apply 50% of the planning fee towards a future event to be scheduled
          within 365 days of the cancelation notice.
        </Text>

        <View style={s.sigBlock}>
          <View style={s.sigCol}>
            <Text style={s.sigLabel}>Customer Signature:</Text>
            <View style={s.sigLine} />
            <View style={s.sigField}>
              <Text style={s.sigFieldLabel}>Name:</Text>
              <View style={s.sigFieldLine} />
            </View>
            <View style={s.sigField}>
              <Text style={s.sigFieldLabel}>Mailing Address:</Text>
              <View style={s.sigFieldLine} />
            </View>
            <View style={s.sigField}>
              <Text style={s.sigFieldLabel}>Phone #</Text>
              <View style={s.sigFieldLine} />
            </View>
            <View style={s.sigField}>
              <Text style={s.sigFieldLabel}>Dated:</Text>
              <View style={s.sigFieldLine} />
            </View>
          </View>

          <View style={s.sigCol}>
            <Text style={s.sigLabel}>EMRG Media LLC</Text>
            <View style={s.sigField}>
              <Text style={s.sigFieldLabel}>By:</Text>
              <View style={s.sigFieldLine} />
            </View>
            {/* Pushes "Dated:" level with the customer's, past Name,
                Mailing Address and Phone on the left. */}
            <View style={{ height: 81 }} />
            <View style={s.sigField}>
              <Text style={s.sigFieldLabel}>Dated:</Text>
              <View style={s.sigFieldLine} />
            </View>
          </View>
        </View>

        <Text style={s.footer}>{EMRG_FOOTER}</Text>
      </Page>
    </Document>
  );
}

/** "an investor event" vs "a holiday party". Small, but it reads wrong otherwise. */
function article(noun: string): string {
  return /^[aeiou]/i.test((noun ?? "").trim()) ? "an" : "a";
}

export default AgreementPDF;
