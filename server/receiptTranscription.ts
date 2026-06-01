// server/receiptTranscription.ts
//
// Verbatim receipt-to-text pipeline for AI Mode attachments.
//
// Why this exists: AI Mode has a parse-and-discard policy on uploaded files
// (privacy + storage). The bytes never persist past the request that uploaded
// them. But the conversational AI needs the receipt's text content available
// for follow-up turns ("change the milk to split only with Krish") — so we
// extract a VERBATIM text transcription on the upload turn, store THAT in
// the message row, and replay it in every future turn's history.
//
// Strategy:
//   1. PDF attachments are tried FIRST with pdf-parse (digital receipts from
//      Uber Eats / DoorDash / Amazon / Apple / etc. have a real text layer).
//      Free, deterministic, ~5ms — beats any AI call.
//   2. PDFs without a usable text layer (scanned, image-only) fall back to
//      Claude vision in a SINGLE batched call along with any image attachments.
//   3. Output is concatenated in original attachment order, separated by
//      "--- ATTACHMENT N ---" headers when there are multiple files.
//
// The output of this module is STORED in ai_messages.attachment_context and
// replayed verbatim in every subsequent Claude turn for the conversation.

// @ts-ignore — pdf-parse ships without bundled types
import pdfParse from "pdf-parse";
import Anthropic from "@anthropic-ai/sdk";
import type { AiAttachment } from "./ai.js";

// Minimum text length we'll accept from pdf-parse before deciding the PDF is
// effectively image-only. Some digital PDFs technically have a text layer but
// it's garbage (1-2 chars of metadata); below this threshold we'd rather pay
// the Claude vision call to get a real transcription.
const MIN_PDF_TEXT_LENGTH = 50;

// Max output tokens for the Claude transcription call. Receipts can be long
// (multi-page Uber Eats with itemized modifiers etc.) — 4096 is generous and
// still under $0.02 per call at Haiku 4.5 pricing.
const TRANSCRIPTION_MAX_TOKENS = 4096;

let _client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

// The transcription prompt is deliberately strict: we want EVERY token from
// the receipt, including the weird annotations that affect splits (unavailable,
// refunded, comp'd, voided, etc.). No summary, no commentary.
const TRANSCRIPTION_SYSTEM_PROMPT = `You are an OCR transcription engine for retail and restaurant receipts (PDFs, photos, or screenshots).

Your job: output the EXACT verbatim text of the attached document(s), line by line, preserving original line breaks, ordering, wording, and numbers.

REQUIRED CONTENT — include every one of these if present:
  - Store / merchant / restaurant name
  - Address, phone, website
  - Date, time, server / cashier name, table number, order number, transaction id
  - Every line item with its full description, modifiers, quantity, and price
  - Every annotation: UNAVAILABLE, REFUNDED, 86'd, COMP'D, VOID, PROMO, DISCOUNT
  - Every fee, surcharge, delivery, service charge
  - Subtotal, every tax line (HST, GST, VAT, etc.), tip suggestions and chosen tip
  - Total, amount paid, change, payment method (last 4 of card)
  - Loyalty / rewards lines
  - Footer text (return policy, hours, "thank you", etc.)
  - Anything else printed on the receipt

FORMAT RULES:
  - Preserve currency symbols, decimals, and quantities exactly as printed.
  - If a line is partially illegible, write what you can read followed by [unclear].
  - For multiple attachments, separate them with a line containing exactly: --- ATTACHMENT N --- (where N is the 1-based index, starting from 2 for the SECOND attachment; the first has no header).
  - Output ONLY the transcription. No commentary, no summary, no markdown bold / italics / headings — just the raw text exactly as it appears on the receipt.`;

// Try pdf-parse on a PDF buffer. Returns null if pdf-parse fails or returns
// too little text to be useful (likely an image-based scan).
export async function tryPdfTextExtraction(buffer: Buffer): Promise<string | null> {
  try {
    const result = await pdfParse(buffer);
    const text = (result.text || "").trim();
    if (text.length < MIN_PDF_TEXT_LENGTH) return null;
    return text;
  } catch (err) {
    console.warn("[receiptTranscription] pdf-parse failed:", (err as Error)?.message);
    return null;
  }
}

// Transcribe one or more attachments with Claude vision in a single API call.
// Used for images and for PDFs without a usable text layer.
export async function transcribeWithClaudeVision(
  attachments: AiAttachment[],
): Promise<string> {
  const client = getClient();
  if (!client) throw new Error("ANTHROPIC_API_KEY missing");
  if (attachments.length === 0) return "";

  const userContent: any[] = [];
  for (const att of attachments) {
    if (att.mimeType === "application/pdf") {
      userContent.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: att.base64 },
      });
    } else if (att.mimeType.startsWith("image/")) {
      const valid = ["image/jpeg", "image/png", "image/webp", "image/gif"];
      const mt = valid.includes(att.mimeType) ? att.mimeType : "image/jpeg";
      userContent.push({
        type: "image",
        source: { type: "base64", media_type: mt, data: att.base64 },
      });
    }
  }
  userContent.push({
    type: "text",
    text: "Transcribe everything you see on the attached receipt(s), verbatim, per the rules in your system prompt.",
  });

  const resp = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: TRANSCRIPTION_MAX_TOKENS,
    system: TRANSCRIPTION_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  const textBlocks = resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
  return textBlocks.map((b) => b.text).join("\n").trim();
}

/**
 * Build the verbatim attachment-context string for the given set of files.
 *
 * Steps for each attachment:
 *   - PDF: try pdf-parse first (digital receipts). If we get >= MIN_PDF_TEXT_LENGTH
 *     chars, use it. Otherwise mark it for Claude vision fallback.
 *   - Image (jpeg/png/etc.): always goes to Claude vision.
 *
 * Vision-needed attachments are batched into ONE Claude call to save cost
 * and latency. The response is split by the "--- ATTACHMENT N ---" separators
 * we instruct Claude to insert.
 *
 * Returns a single string ready to be stored in ai_messages.attachment_context
 * and replayed verbatim in subsequent Claude turns.
 */
export async function buildAttachmentContext(
  attachments: AiAttachment[],
): Promise<string> {
  if (attachments.length === 0) return "";

  // texts[i] will hold the transcription for attachments[i], filled in
  // either by pdf-parse below or by the batched Claude vision call after.
  const texts: (string | null)[] = new Array(attachments.length).fill(null);
  const needsVision: Array<{ index: number; att: AiAttachment }> = [];

  // First pass — pdf-parse fast path for digital PDFs
  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i];
    if (att.mimeType === "application/pdf") {
      const buffer = Buffer.from(att.base64, "base64");
      const text = await tryPdfTextExtraction(buffer);
      if (text) {
        texts[i] = text;
      } else {
        needsVision.push({ index: i, att });
      }
    } else if (att.mimeType.startsWith("image/")) {
      needsVision.push({ index: i, att });
    }
    // Anything else (shouldn't happen — multer filter rejects non-pdf/image)
    // is silently skipped.
  }

  // Second pass — one Claude vision call for everything still pending
  if (needsVision.length > 0) {
    try {
      const visionOutput = await transcribeWithClaudeVision(
        needsVision.map((n) => n.att),
      );
      // Split on the separator we asked Claude to use. The first chunk
      // belongs to attachment #1, the second to #2, etc.
      const chunks = visionOutput
        .split(/\n*---\s*ATTACHMENT\s+\d+\s*---\n*/i)
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      for (let i = 0; i < needsVision.length; i++) {
        const idx = needsVision[i].index;
        // Safety: if Claude returned fewer chunks than expected, fall back
        // to the whole transcription so we don't silently lose data.
        texts[idx] = chunks[i] ?? visionOutput;
      }
    } catch (err) {
      console.error("[receiptTranscription] Claude vision failed:", err);
      // Don't fail the whole turn — leave those slots as a stub so the AI
      // turn can still proceed (it just won't have receipt text for those).
      for (const n of needsVision) {
        if (texts[n.index] === null) {
          texts[n.index] = `[transcription failed for ${n.att.filename ?? "attachment"}]`;
        }
      }
    }
  }

  // Combine in original order with separators
  if (texts.length === 1) return texts[0] || "";
  return texts
    .map((t, i) => (i === 0 ? t || "" : `--- ATTACHMENT ${i + 1} ---\n${t || ""}`))
    .join("\n\n");
}
