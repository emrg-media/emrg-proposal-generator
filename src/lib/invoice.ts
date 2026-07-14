// Shared invoice engine: types, math, and formatting used by both the builder
// UI and the PDF. Storage-agnostic, so persistence can be added later without
// touching this logic.

export const DEFAULT_TAX_RATE = 8.875; // NY sales tax, per line toggle

export interface InvoiceLineItem {
  id: string;
  description: string;
  quantity: string;   // raw input; ignored when perGuest is true
  unitPrice: string;  // raw currency input
  perGuest: boolean;  // when true, quantity comes from the invoice guest count
  taxable: boolean;
}

export interface Payment {
  id: string;
  date: string;
  method: string;
  amount: string;
}

export interface InvoiceData {
  invoiceNumber: string;
  company: string;
  contact: string;
  email: string;
  event: string;
  eventDate: string;
  guestCount: string;
  issueDate: string;
  dueDate: string;
  lineItems: InvoiceLineItem[];
  payments: Payment[];
  taxRate: number;
  notes: string;
}

export interface ComputedLine extends InvoiceLineItem {
  effectiveQty: number;
  unit: number;
  lineTotal: number;
}

export interface InvoiceTotals {
  lines: ComputedLine[];
  subtotal: number;
  taxableSubtotal: number;
  tax: number;
  total: number;
  paid: number;
  balance: number;
  paidInFull: boolean;
}

export function parseNum(v: string | number | undefined): number {
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  if (!v) return 0;
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 0 : n;
}

export function fmtMoney(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function computeInvoice(inv: InvoiceData): InvoiceTotals {
  const guests = parseNum(inv.guestCount);
  const lines: ComputedLine[] = inv.lineItems.map((li) => {
    const unit = parseNum(li.unitPrice);
    const effectiveQty = li.perGuest ? guests : parseNum(li.quantity);
    return { ...li, unit, effectiveQty, lineTotal: unit * effectiveQty };
  });

  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  const taxableSubtotal = lines.filter((l) => l.taxable).reduce((s, l) => s + l.lineTotal, 0);
  const tax = taxableSubtotal * (inv.taxRate / 100);
  const total = subtotal + tax;
  const paid = inv.payments.reduce((s, p) => s + parseNum(p.amount), 0);
  const balance = total - paid;
  const paidInFull = total > 0 && balance <= 0.005;

  return { lines, subtotal, taxableSubtotal, tax, total, paid, balance, paidInFull };
}
