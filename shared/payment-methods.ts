// shared/payment-methods.ts
//
// Single source of truth for the payment-method types users can pick when
// setting "how I want to get paid back." Shared by client (the editor +
// display) and server (validation). Keep the `id` values stable — they're
// persisted in the users.paymentMethods JSON.

export interface PaymentMethodType {
  id: string;          // stable persisted key
  label: string;       // shown in the dropdown + display
  // What the `value` field represents, used as the input placeholder/hint.
  valueHint: string;
}

export const PAYMENT_METHOD_TYPES: PaymentMethodType[] = [
  { id: "interac",   label: "Interac e-Transfer", valueHint: "email or phone number" },
  { id: "paypal",    label: "PayPal",             valueHint: "PayPal email or paypal.me link" },
  { id: "venmo",     label: "Venmo",              valueHint: "@username" },
  { id: "cashapp",   label: "Cash App",           valueHint: "$cashtag" },
  { id: "zelle",     label: "Zelle",              valueHint: "email or phone number" },
  { id: "revolut",   label: "Revolut",            valueHint: "@revtag or phone" },
  { id: "wise",      label: "Wise",               valueHint: "email" },
  { id: "bank",      label: "Bank transfer",      valueHint: "account details" },
  { id: "cash",      label: "Cash",               valueHint: "(optional note, e.g. in person)" },
  { id: "other",     label: "Other",              valueHint: "describe how to pay you" },
];

const TYPE_IDS = new Set(PAYMENT_METHOD_TYPES.map((t) => t.id));

export interface PaymentMethod {
  type: string;   // one of PAYMENT_METHOD_TYPES ids
  value: string;  // email / phone / handle / note
}

export const MAX_PAYMENT_METHODS = 6;
export const MAX_PAYMENT_VALUE_LEN = 120;
export const MAX_PAYMENT_NOTE_LEN = 280;

/** Human label for a method type id (falls back to the raw id). */
export function paymentMethodLabel(typeId: string): string {
  return PAYMENT_METHOD_TYPES.find((t) => t.id === typeId)?.label || typeId;
}

/**
 * Validate + normalize a raw payment-methods payload from the client.
 * Returns a clean array (≤ MAX, valid types, trimmed/capped values, no
 * empty values). Defensive — never throws. Used server-side before persist.
 */
export function sanitizePaymentMethods(raw: unknown): PaymentMethod[] {
  if (!Array.isArray(raw)) return [];
  const out: PaymentMethod[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const type = String((m as any).type || "").trim();
    let value = String((m as any).value || "").trim();
    if (!TYPE_IDS.has(type)) continue;          // unknown type → skip
    if (value.length === 0) continue;            // empty value → skip
    if (value.length > MAX_PAYMENT_VALUE_LEN) value = value.slice(0, MAX_PAYMENT_VALUE_LEN);
    out.push({ type, value });
    if (out.length >= MAX_PAYMENT_METHODS) break;
  }
  return out;
}

/** Parse the stored JSON string back into a typed array. Safe on garbage. */
export function parsePaymentMethods(stored: string | null | undefined): PaymentMethod[] {
  if (!stored) return [];
  try {
    return sanitizePaymentMethods(JSON.parse(stored));
  } catch {
    return [];
  }
}
