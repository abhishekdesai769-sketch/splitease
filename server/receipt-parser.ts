import Anthropic from "@anthropic-ai/sdk";

// Enabled whenever ANTHROPIC_API_KEY is present in the environment
export const RECEIPT_SCANNING_ENABLED = !!process.env.ANTHROPIC_API_KEY;

export interface ReceiptItem {
  name: string;
  price: number;
}

export interface ReceiptData {
  merchant: string;
  date: string | null;
  items: ReceiptItem[];
  subtotal: number | null;
  tax: number | null;
  total: number | null;
}

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

/**
 * Parse a receipt image using Claude Haiku vision.
 * Returns structured receipt data or null on failure.
 */
export async function parseReceipt(
  imageBuffer: Buffer,
  mimeType: string
): Promise<ReceiptData | null> {
  const anthropic = getClient();
  if (!anthropic) {
    console.error("Receipt parser: ANTHROPIC_API_KEY not set");
    return null;
  }

  // Validate mime type
  const validTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  const mediaType = validTypes.includes(mimeType) ? mimeType : "image/jpeg";

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
                data: imageBuffer.toString("base64"),
              },
            },
            {
              type: "text",
              text: `Extract all data from this receipt. Return ONLY valid JSON in this exact format, no other text:
{
  "merchant": "Store Name",
  "date": "Apr 20, 2026",
  "items": [
    { "name": "Item description", "price": 1.99 }
  ],
  "subtotal": 10.00,
  "tax": 1.30,
  "total": 11.30
}

Rules:
- merchant: the store or restaurant name
- date: the date printed on the receipt (e.g. "Apr 20, 2026"), or null if not visible
- Extract every line item with its price
- Use null for subtotal, tax, total, or date if not visible
- Prices should be numbers, not strings
- If this is not a receipt, return: { "merchant": "Unknown", "date": null, "items": [], "subtotal": null, "tax": null, "total": null }`,
            },
          ],
        },
      ],
    });

    // Extract text response
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;

    // Parse JSON from response (handle markdown code blocks)
    let jsonStr = textBlock.text.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const parsed = JSON.parse(jsonStr) as ReceiptData;

    // Basic validation
    if (!parsed.merchant || !Array.isArray(parsed.items)) return null;

    // Ensure all items have name and numeric price
    parsed.items = parsed.items.filter(
      (item) => item.name && typeof item.price === "number"
    );

    return parsed;
  } catch (err) {
    console.error("Receipt parsing failed:", err);
    return null;
  }
}
