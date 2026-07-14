import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import { createElement } from "react";
import { computeInvoice, fmtMoney, type InvoiceData } from "@/lib/invoice";

// Draft invoice format. To be refined to match EMRG's real invoices once samples arrive.

const C = {
  red: "#c0182a",
  black: "#111111",
  gray: "#57534e",
  light: "#a8a29e",
  border: "#d6d3d1",
  bg: "#fafaf9",
  headBg: "#111111",
};

const s = StyleSheet.create({
  page: { paddingHorizontal: 44, paddingVertical: 40, fontFamily: "Helvetica", fontSize: 9.5, color: C.black },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22 },
  logo: { width: 150 },
  invoiceTitle: { fontFamily: "Helvetica-Bold", fontSize: 22, color: C.black, textAlign: "right" },
  invoiceMeta: { fontSize: 9.5, color: C.gray, textAlign: "right", marginTop: 4 },
  billBlock: { marginBottom: 16 },
  billLabel: { fontSize: 8, letterSpacing: 1, color: C.light, marginBottom: 3, fontFamily: "Helvetica-Bold" },
  billName: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  billLine: { fontSize: 9.5, color: C.gray, marginTop: 1 },
  metaGrid: { flexDirection: "row", gap: 28, marginBottom: 18 },
  metaItem: {},
  // Table
  tHead: { flexDirection: "row", backgroundColor: C.headBg, color: "#fff", paddingVertical: 5, paddingHorizontal: 6 },
  th: { fontFamily: "Helvetica-Bold", fontSize: 8, letterSpacing: 0.5 },
  tRow: { flexDirection: "row", borderBottomWidth: 0.75, borderColor: C.border, paddingVertical: 5, paddingHorizontal: 6 },
  td: { fontSize: 9 },
  cDesc: { flex: 1 },
  cQty: { width: 46, textAlign: "right" },
  cPrice: { width: 66, textAlign: "right" },
  cTax: { width: 30, textAlign: "center" },
  cTotal: { width: 74, textAlign: "right" },
  // Totals
  totalsWrap: { flexDirection: "row", justifyContent: "flex-end", marginTop: 14 },
  totalsBox: { width: 230 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2.5 },
  totalLabel: { fontSize: 9.5, color: C.gray },
  totalValue: { fontSize: 9.5, textAlign: "right" },
  grandRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, borderTopWidth: 1, borderColor: C.black, marginTop: 3 },
  grandLabel: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  grandValue: { fontSize: 11, fontFamily: "Helvetica-Bold", textAlign: "right" },
  balanceRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, backgroundColor: C.bg, paddingHorizontal: 6, marginTop: 4 },
  balanceLabel: { fontSize: 10.5, fontFamily: "Helvetica-Bold", color: C.red },
  balanceValue: { fontSize: 10.5, fontFamily: "Helvetica-Bold", color: C.red, textAlign: "right" },
  // Payments
  sectionTitle: { fontFamily: "Helvetica-Bold", fontSize: 10, marginTop: 24, marginBottom: 6 },
  payRow: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: C.border, paddingVertical: 3.5 },
  payDate: { width: 90, fontSize: 9 },
  payMethod: { flex: 1, fontSize: 9 },
  payAmt: { width: 80, fontSize: 9, textAlign: "right" },
  paidStamp: { marginTop: 20, alignSelf: "flex-end", borderWidth: 2, borderColor: "#15803d", color: "#15803d", paddingVertical: 5, paddingHorizontal: 14, fontFamily: "Helvetica-Bold", fontSize: 13, letterSpacing: 1 },
  footer: { position: "absolute", bottom: 28, left: 44, right: 44, borderTopWidth: 0.75, borderColor: "#e7e5e4", paddingTop: 8, textAlign: "center", fontSize: 8, color: C.light },
});

const EMRG_ADDRESS = "EMRG Media, 60 Sutton Place South, Suite 8LS, New York NY 10022  |  212.254.3700  |  www.emrgmedia.com";

export function InvoicePDF({ data, logoBase64 }: { data: InvoiceData; logoBase64: string }) {
  const t = computeInvoice(data);
  return (
    <Document>
      <Page size="LETTER" style={s.page}>
        <View style={s.headerRow}>
          <Image src={`data:image/png;base64,${logoBase64}`} style={s.logo} />
          <View>
            <Text style={s.invoiceTitle}>INVOICE</Text>
            <Text style={s.invoiceMeta}>{data.invoiceNumber || "Draft"}</Text>
          </View>
        </View>

        <View style={s.billBlock}>
          <Text style={s.billLabel}>BILL TO</Text>
          <Text style={s.billName}>{data.company || "Client"}</Text>
          {data.contact ? <Text style={s.billLine}>{data.contact}</Text> : null}
          {data.email ? <Text style={s.billLine}>{data.email}</Text> : null}
        </View>

        <View style={s.metaGrid}>
          {data.event ? <View style={s.metaItem}><Text style={s.billLabel}>EVENT</Text><Text style={s.billLine}>{data.event}</Text></View> : null}
          {data.eventDate ? <View style={s.metaItem}><Text style={s.billLabel}>EVENT DATE</Text><Text style={s.billLine}>{data.eventDate}</Text></View> : null}
          {data.guestCount ? <View style={s.metaItem}><Text style={s.billLabel}>GUESTS</Text><Text style={s.billLine}>{data.guestCount}</Text></View> : null}
          {data.dueDate ? <View style={s.metaItem}><Text style={s.billLabel}>DUE</Text><Text style={s.billLine}>{data.dueDate}</Text></View> : null}
        </View>

        {/* Line items */}
        <View style={s.tHead}>
          <Text style={[s.th, s.cDesc]}>DESCRIPTION</Text>
          <Text style={[s.th, s.cQty]}>QTY</Text>
          <Text style={[s.th, s.cPrice]}>UNIT</Text>
          <Text style={[s.th, s.cTax]}>TAX</Text>
          <Text style={[s.th, s.cTotal]}>AMOUNT</Text>
        </View>
        {t.lines.map((l) => (
          <View style={s.tRow} key={l.id}>
            <Text style={[s.td, s.cDesc]}>{l.description || " "}</Text>
            <Text style={[s.td, s.cQty]}>{l.perGuest ? `${l.effectiveQty} (pg)` : l.effectiveQty}</Text>
            <Text style={[s.td, s.cPrice]}>{fmtMoney(l.unit)}</Text>
            <Text style={[s.td, s.cTax]}>{l.taxable ? "Yes" : "No"}</Text>
            <Text style={[s.td, s.cTotal]}>{fmtMoney(l.lineTotal)}</Text>
          </View>
        ))}

        {/* Totals */}
        <View style={s.totalsWrap}>
          <View style={s.totalsBox}>
            <View style={s.totalRow}><Text style={s.totalLabel}>Subtotal</Text><Text style={s.totalValue}>{fmtMoney(t.subtotal)}</Text></View>
            <View style={s.totalRow}><Text style={s.totalLabel}>Tax ({data.taxRate}% on {fmtMoney(t.taxableSubtotal)})</Text><Text style={s.totalValue}>{fmtMoney(t.tax)}</Text></View>
            <View style={s.grandRow}><Text style={s.grandLabel}>Total</Text><Text style={s.grandValue}>{fmtMoney(t.total)}</Text></View>
            {t.paid > 0 ? <View style={s.totalRow}><Text style={s.totalLabel}>Paid to date</Text><Text style={s.totalValue}>{fmtMoney(t.paid)}</Text></View> : null}
            <View style={s.balanceRow}><Text style={s.balanceLabel}>Balance Due</Text><Text style={s.balanceValue}>{fmtMoney(Math.max(0, t.balance))}</Text></View>
          </View>
        </View>

        {/* Payment log */}
        {data.payments.length > 0 ? (
          <View>
            <Text style={s.sectionTitle}>Payments</Text>
            {data.payments.map((p) => (
              <View style={s.payRow} key={p.id}>
                <Text style={s.payDate}>{p.date || " "}</Text>
                <Text style={s.payMethod}>{p.method || " "}</Text>
                <Text style={s.payAmt}>{fmtMoney(Number(p.amount ? p.amount.replace(/[^0-9.]/g, "") : 0))}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {t.paidInFull ? <Text style={s.paidStamp}>PAID IN FULL</Text> : null}

        <Text style={s.footer}>{EMRG_ADDRESS}</Text>
      </Page>
    </Document>
  );
}

export function buildInvoiceDocument(data: InvoiceData, logoBase64: string) {
  return createElement(InvoicePDF, { data, logoBase64 });
}
