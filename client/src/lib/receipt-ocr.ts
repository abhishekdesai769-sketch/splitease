import Tesseract from "tesseract.js";

export interface ReceiptItem {
  name: string;
  price: number;
}

export interface ReceiptData {
  merchant: string;
  items: ReceiptItem[];
  subtotal: number | null;
  tax: number | null;
  total: number | null;
}

/**
 * Run OCR on a receipt image using Tesseract.js (runs in browser via Web Worker).
 * Returns raw extracted text.
 */
export async function ocrReceipt(imageFile: File): Promise<string> {
  const { data } = await Tesseract.recognize(imageFile, "eng", {
    logger: () => {}, // suppress progress logs
  });
  return data.text;
}

/**
 * Parse raw OCR text into structured receipt data.
 * Best-effort regex parsing — works well on clean printed receipts.
 */
export function parseReceiptText(rawText: string): ReceiptData {
  const lines = rawText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Extract merchant — first non-empty line that doesn't look like a number/date
  let merchant = "Unknown";
  for (const line of lines) {
    // Skip lines that are mostly numbers, dates, or very short
    if (/^\d/.test(line) || line.length < 3) continue;
    if (/^\d{1,2}[\/-]\d{1,2}/.test(line)) continue;
    merchant = line.replace(/[#*=]/g, "").trim();
    break;
  }

  // Extract line items — look for patterns like "ITEM NAME    10.99" or "Item $10.99"
  const items: ReceiptItem[] = [];
  const itemPattern = /^(.+?)\s+\$?\s*(\d+\.\d{2})\s*$/;
  const itemPatternAlt = /^(.+?)\s{2,}(\d+\.\d{2})/;

  // Keywords that indicate summary lines (not items)
  const summaryKeywords = /^(subtotal|sub\s*total|total|tax|hst|gst|pst|qst|tip|gratuity|change|cash|credit|debit|visa|mastercard|amex|balance|discount|savings|points|card|payment)/i;

  for (const line of lines) {
    // Try matching item patterns
    const match = line.match(itemPattern) || line.match(itemPatternAlt);
    if (!match) continue;

    const name = match[1].replace(/[.]{2,}/g, "").trim();
    const price = parseFloat(match[2]);

    // Skip if name looks like a summary line
    if (summaryKeywords.test(name)) continue;
    // Skip if name is too short or price is unreasonable
    if (name.length < 2 || isNaN(price) || price <= 0 || price > 99999) continue;

    items.push({ name, price });
  }

  // Extract subtotal, tax, total
  let subtotal: number | null = null;
  let tax: number | null = null;
  let total: number | null = null;

  for (const line of lines) {
    const lower = line.toLowerCase();
    const numMatch = line.match(/\$?\s*(\d+\.\d{2})\s*$/);
    if (!numMatch) continue;
    const val = parseFloat(numMatch[1]);

    if (/sub\s*total/i.test(lower) && subtotal === null) {
      subtotal = val;
    } else if (/^(tax|hst|gst|pst|qst)/i.test(lower) && tax === null) {
      tax = val;
    } else if (/^total/i.test(lower) && total === null) {
      total = val;
    }
  }

  return { merchant, items, subtotal, tax, total };
}
