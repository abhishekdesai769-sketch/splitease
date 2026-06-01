// AI Mode — conversational expense entry powered by Claude Haiku 4.5.
//
// The model never directly writes to the database. It returns structured
// proposals via tool calls, which the client renders as confirmation cards.
// The user explicitly taps "Create" to commit a proposal — that path goes
// through the existing /api/expenses + /api/friends/expenses endpoints,
// reusing all the validation + balance logic we already trust.
//
// LOCKED logic note: this module never touches lib/simplify.ts or any
// balance math. It only produces expense-creation proposals which the
// existing endpoints then process.

import Anthropic from "@anthropic-ai/sdk";

export const AI_MODE_ENABLED = !!process.env.ANTHROPIC_API_KEY;

let _client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

// ── Types ────────────────────────────────────────────────────────────────

export interface UserContext {
  userId: string;
  userName: string;
  friends: Array<{ id: string; name: string; email?: string | null }>;
  groups: Array<{ id: string; name: string; memberIds: string[]; memberNames: Record<string, string> }>;
}

export interface ExpenseProposal {
  description: string;
  amount: number;
  paidByUserId: string;
  splitAmongUserIds: string[];
  splitAmounts?: Record<string, number>;  // unequal split: { userId: amount }
  groupId?: string | null;
  currency?: string;
}

export type AiResultKind = "proposal" | "multi_proposal" | "clarification" | "text";

export interface AiTurnResult {
  kind: AiResultKind;
  // Populated based on kind:
  assistantText?: string;        // always set (the human-readable response)
  proposal?: ExpenseProposal;
  multiProposal?: ExpenseProposal[];
  clarification?: string;
  // Raw tool calls Claude made (for persistence + analytics)
  rawToolCalls?: any[];
  // Token usage for cost tracking
  usage?: { inputTokens: number; outputTokens: number };
}

export interface AiMessageInput {
  role: "user" | "assistant";
  content: string;
  // If a previous assistant message proposed something, include it so Claude
  // can reference / refine. Stringified JSON.
  proposalJson?: string | null;
}

/**
 * Attachment passed to Claude for vision/document parsing. We never persist
 * the actual `base64` bytes — the buffer lives in memory for one request,
 * gets sent to Anthropic, and is discarded as soon as the response returns.
 * The message's audit row in Postgres only records metadata (filename, mime,
 * size) for transcript display purposes — NOT the contents.
 */
export interface AiAttachment {
  base64: string;
  mimeType: string;       // "application/pdf" | "image/jpeg" | "image/png" | "image/webp" | "image/gif"
  filename?: string;
  sizeBytes?: number;
}

// ── Tool definitions ────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: "propose_expense",
    description:
      "Propose a single expense for the user to review and confirm. " +
      "Does NOT create the expense — it only returns a structured proposal " +
      "that the client will render as a confirmation card. " +
      "Use this whenever the user describes ONE expense they want to log. " +
      "All user IDs you use must come from the user's friends/groups context — " +
      "do not invent IDs.",
    input_schema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "Short description of what the expense was for (e.g. 'Groceries', 'Sushi dinner').",
        },
        amount: {
          type: "number",
          description: "Total amount of the expense in the chosen currency. Must be > 0.",
        },
        paidByUserId: {
          type: "string",
          description:
            "User ID of the person who paid the bill. Default to the current user's ID unless the user said someone else paid.",
        },
        splitAmongUserIds: {
          type: "array",
          items: { type: "string" },
          description:
            "User IDs the expense is split among. For an equal split between you and one friend, this is [currentUserId, friendId]. " +
            "If only one ID is provided, that single user bears the full cost.",
        },
        splitAmounts: {
          type: "object",
          description:
            "OPTIONAL. Unequal split: a map of userId -> amount. The amounts must sum to `amount`. " +
            "If provided, splitAmongUserIds must contain exactly the same user IDs as this object's keys. " +
            "Omit for equal splits.",
        },
        groupId: {
          type: "string",
          description:
            "OPTIONAL. The Spliiit group ID this expense belongs to. " +
            "Set when the user mentions a group by name and you can match it in the user's groups context. " +
            "Omit for direct-friend expenses (no group).",
        },
        currency: {
          type: "string",
          description:
            "OPTIONAL. 3-letter currency code (USD, CAD, EUR, etc.). Default CAD if the user didn't specify.",
        },
      },
      required: ["description", "amount", "paidByUserId", "splitAmongUserIds"],
    },
  },
  {
    name: "propose_multiple_expenses",
    description:
      "Propose MULTIPLE expenses at once. Use this when a receipt has been " +
      "split into per-item expenses (e.g., 'split the receipt by item, " +
      "Krish had the wine, we shared the food'). " +
      "The user reviews all of them and taps Create All to commit. " +
      "Each item follows the same rules as propose_expense.",
    input_schema: {
      type: "object",
      properties: {
        expenses: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              amount: { type: "number" },
              paidByUserId: { type: "string" },
              splitAmongUserIds: { type: "array", items: { type: "string" } },
              splitAmounts: { type: "object" },
              groupId: { type: "string" },
              currency: { type: "string" },
            },
            required: ["description", "amount", "paidByUserId", "splitAmongUserIds"],
          },
        },
      },
      required: ["expenses"],
    },
  },
  {
    name: "ask_clarification",
    description:
      "Use this when the user's request is genuinely ambiguous and you " +
      "cannot confidently propose an expense (e.g., they said 'Krish' but " +
      "there are two friends named Krish — ask which one). " +
      "Do NOT use this for trivial details you can default reasonably (currency, " +
      "split type, etc.). Only ask when guessing would be wrong.",
    input_schema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The one focused follow-up question to ask the user.",
        },
      },
      required: ["question"],
    },
  },
];

// ── System prompt ────────────────────────────────────────────────────────

function buildSystemPrompt(ctx: UserContext): string {
  const friendsList = ctx.friends.length === 0
    ? "  (none yet)"
    : ctx.friends.map((f) => `  - ${f.name} → id: ${f.id}`).join("\n");

  const groupsList = ctx.groups.length === 0
    ? "  (none yet)"
    : ctx.groups.map((g) => {
        const memberLabels = g.memberIds.map((id) => {
          if (id === ctx.userId) return ctx.userName + " (you)";
          return g.memberNames[id] || id;
        });
        return `  - "${g.name}" → id: ${g.id}\n      members: ${memberLabels.join(", ")}`;
      }).join("\n");

  return `You are Spliiit's AI assistant. You help users log expenses by parsing natural-language descriptions into structured expense proposals. Be concise, friendly, and DECISIVE.

## CONTEXT ABOUT THE CURRENT USER

The user's display name is: ${ctx.userName}
Their user ID is: ${ctx.userId}

Their friends (use these IDs when they refer to a friend):
${friendsList}

Their groups:
${groupsList}

## YOUR JOB

When the user describes a shared expense, call propose_expense (or propose_multiple_expenses for receipts split by item) with a structured proposal. The user will see your proposal as a card with a Create button — they confirm before anything actually saves.

## HANDLING RECEIPTS (PDF OR IMAGE ATTACHMENTS) — CRITICAL

When a user attaches a receipt (PDF or image), the file bytes are ONLY available to you in THIS single turn. After this turn they are discarded — they will NOT be in conversation history for subsequent turns. The only thing that survives is your text response. Therefore:

A. **You MUST itemize the receipt in your text response.** Before (or alongside) proposing splits, write out a complete bulleted list of every line item from the receipt with its individual price. Include subtotal, tax, and tip lines if visible. Use this format:

\`\`\`
Receipt contents:
- Milk: $4.50
- Protein yogurt: $7.00
- Bananas: $3.20
- ... (every item)
Subtotal: $X
Tax: $Y
Total: $Z
\`\`\`

This is non-negotiable — without this itemized record, follow-up turns will have no memory of what was on the receipt. Even if you also call a proposal tool, the text response still must contain the itemized list.

B. **Propose splits immediately if you can infer the participants.** Don't ask clarifying questions when you can make a reasonable proposal:
- If the user mentioned a group or friend in this turn or earlier in the conversation, use it.
- If the user said "split among the four of us" and is in a 4-person group, use that group.
- Only call ask_clarification if there is GENUINE ambiguity that you cannot resolve from context (e.g., two friends with the same first name).
- If the user gave per-item assignment rules ("X is mine, Y is split 4 ways"), follow them — and if amounts are visible in the receipt, compute the splits yourself; don't ask the user for amounts that are right there in the receipt.

C. **In follow-up turns that reference "the receipt"**: look at your OWN prior assistant messages in conversation history for the itemized list. If you find it, use those numbers — you do NOT need the file re-attached. If you DON'T find an itemized list in history (e.g., a prior turn missed step A), be honest: tell the user the receipt content wasn't preserved in memory and ask them to re-attach it. NEVER tell the user "I don't have access to the receipt image" if you simply have an attachment in the current turn — check the current turn's content blocks first.

## CRITICAL RULES

1. **Never invent user IDs.** Only use IDs from the friends + groups context above. If a name doesn't match, use ask_clarification.

2. **Default to the current user as the payer** unless the user clearly says someone else paid (e.g., "Krish bought lunch for me", "she covered the bill").

3. **Default to equal splits** unless the user specifies otherwise.

4. **Currency defaults to CAD** unless the user mentions one.

5. **For group expenses:** if the user names a group (e.g., "split it in our Halifax group"), match it case-insensitively in their groups list. If no group is mentioned, treat it as a direct-friend expense (no groupId).

6. **For per-item receipt splits:** use propose_multiple_expenses with one entry per assigned item.

7. **When uncertain about WHO** (name collision, ambiguous reference), call ask_clarification. NEVER guess between two friends with the same first name.

8. **When uncertain about AMOUNT or DESCRIPTION**, default reasonably and proceed — the user will edit on the proposal card if it's wrong.

9. **Keep responses BRIEF in non-receipt cases.** A one-line confirmation is enough ("Here's what I'm proposing.") — don't repeat proposal details in prose; the UI shows them. EXCEPTION: receipts MUST include the full itemized list per section A above.

10. **You CANNOT settle balances, delete expenses, change subscriptions, or invite users.** Stay strictly within expense-logging.

If the user asks something unrelated to expenses (jokes, support, "how do I use Spliiit"), respond briefly with text — no tool calls.`;
}

// ── Main entrypoint ──────────────────────────────────────────────────────

/**
 * Run one turn of the AI conversation.
 * @param ctx - Current user's context (friends, groups, etc.)
 * @param history - Prior messages in this conversation (user + assistant turns)
 * @param newUserMessage - The user's just-typed message
 * @param attachments - Optional images/PDFs to pass to Claude as content blocks.
 *                       Bytes are sent to Anthropic and then forgotten — we
 *                       never persist the file data anywhere on our side.
 */
export async function runAiTurn(params: {
  ctx: UserContext;
  history: AiMessageInput[];
  newUserMessage: string;
  attachments?: AiAttachment[];
}): Promise<AiTurnResult> {
  const client = getClient();
  if (!client) {
    throw new Error("AI Mode not configured — ANTHROPIC_API_KEY missing");
  }

  const { ctx, history, newUserMessage, attachments } = params;

  // Build messages array. Truncate history to last 20 entries to avoid
  // runaway token costs — most real conversations are 2-6 turns anyway.
  // Note: prior turns' attachments are NOT replayed (token cost + Claude has
  // already absorbed their content into prior responses). Only the current
  // turn's attachments are sent.
  const trimmedHistory = history.slice(-20);
  const messages: Anthropic.MessageParam[] = trimmedHistory.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Build the current user turn — text-only OR text + multimodal content blocks
  if (attachments && attachments.length > 0) {
    const userContent: any[] = [];
    // Per Anthropic's docs, putting attachments BEFORE the text prompt
    // generally yields better extraction quality on receipts.
    for (const att of attachments) {
      if (att.mimeType === "application/pdf") {
        userContent.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: att.base64 },
        });
      } else if (att.mimeType.startsWith("image/")) {
        const validImageTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
        const mt = validImageTypes.includes(att.mimeType) ? att.mimeType : "image/jpeg";
        userContent.push({
          type: "image",
          source: { type: "base64", media_type: mt, data: att.base64 },
        });
      }
      // Silently skip anything that isn't an image or PDF (validation
      // already happened at the route layer, but defensive double-check).
    }
    // Add the user's text last. We prepend a non-negotiable instruction
    // about itemizing the receipt, because:
    //   (a) the file bytes won't survive to the next turn (parse-and-discard
    //       privacy policy), so the parsed contents MUST go into the text
    //       response to be available for follow-ups
    //   (b) Claude's default behaviour is to ask clarifying questions before
    //       parsing — we want it to itemize first, propose splits second
    const itemizationInstruction =
      "SYSTEM INSTRUCTION FOR THIS TURN: A receipt is attached above. " +
      "You MUST: (1) read every line item and price from the receipt and write " +
      "them out as a bulleted list in your response (include subtotal, tax, tip, " +
      "total if visible) — this is required because the file is discarded after " +
      "this turn and the itemized list is the only way to remember the contents " +
      "in future turns; (2) THEN propose splits using propose_expense or " +
      "propose_multiple_expenses based on the user's instructions and the " +
      "amounts you just extracted — don't ask the user for amounts that are " +
      "visible in the receipt; (3) only ask for clarification if you genuinely " +
      "cannot infer the participants.\n\n";
    const userText = newUserMessage.trim().length > 0
      ? newUserMessage
      : "Here's the receipt — parse it and propose how to split it. If I haven't told you who to split with, infer from our group / friend context.";
    userContent.push({ type: "text", text: itemizationInstruction + "USER MESSAGE: " + userText });

    messages.push({ role: "user", content: userContent });
  } else {
    messages.push({ role: "user", content: newUserMessage });
  }

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: buildSystemPrompt(ctx),
    tools: TOOLS,
    messages,
  });

  // Find text + tool_use blocks in the response
  const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
  const toolBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

  const assistantText = textBlocks.map((b) => b.text).join("\n").trim() || undefined;
  const usage = response.usage
    ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
    : undefined;

  // Branch by which tool (if any) Claude called
  if (toolBlocks.length > 0) {
    const tool = toolBlocks[0]; // we only honor the first tool call per turn

    if (tool.name === "propose_expense") {
      const input = tool.input as any;
      const proposal: ExpenseProposal = {
        description: String(input.description || ""),
        amount: Number(input.amount || 0),
        paidByUserId: String(input.paidByUserId || ctx.userId),
        splitAmongUserIds: Array.isArray(input.splitAmongUserIds) ? input.splitAmongUserIds.map(String) : [],
        splitAmounts: input.splitAmounts && typeof input.splitAmounts === "object" ? input.splitAmounts : undefined,
        groupId: input.groupId ? String(input.groupId) : null,
        currency: input.currency ? String(input.currency).toUpperCase() : "CAD",
      };
      return {
        kind: "proposal",
        assistantText: assistantText ?? "Here's what I've got — review and tap Create when you're ready.",
        proposal,
        rawToolCalls: toolBlocks,
        usage,
      };
    }

    if (tool.name === "propose_multiple_expenses") {
      const input = tool.input as any;
      const raw = Array.isArray(input.expenses) ? input.expenses : [];
      const multiProposal: ExpenseProposal[] = raw.map((r: any) => ({
        description: String(r.description || ""),
        amount: Number(r.amount || 0),
        paidByUserId: String(r.paidByUserId || ctx.userId),
        splitAmongUserIds: Array.isArray(r.splitAmongUserIds) ? r.splitAmongUserIds.map(String) : [],
        splitAmounts: r.splitAmounts && typeof r.splitAmounts === "object" ? r.splitAmounts : undefined,
        groupId: r.groupId ? String(r.groupId) : null,
        currency: r.currency ? String(r.currency).toUpperCase() : "CAD",
      }));
      return {
        kind: "multi_proposal",
        assistantText: assistantText ?? `Got it — ${multiProposal.length} expenses ready for review.`,
        multiProposal,
        rawToolCalls: toolBlocks,
        usage,
      };
    }

    if (tool.name === "ask_clarification") {
      const input = tool.input as any;
      const question = String(input.question || "Could you clarify?");
      return {
        kind: "clarification",
        assistantText: question,
        clarification: question,
        rawToolCalls: toolBlocks,
        usage,
      };
    }
  }

  // No tool call — plain text response
  return {
    kind: "text",
    assistantText: assistantText ?? "Got it.",
    usage,
  };
}

/**
 * Build the UserContext for a given user — fetches their friends + groups
 * with member names resolved so Claude can match names to IDs.
 * Caller passes pre-fetched data to keep this module storage-agnostic.
 */
export function buildUserContext(params: {
  userId: string;
  userName: string;
  friends: Array<{ id: string; name: string; email?: string | null }>;
  groups: Array<{ id: string; name: string; memberIds: string[] }>;
  allKnownUserNames: Record<string, string>; // id -> name, used to populate group member names
}): UserContext {
  return {
    userId: params.userId,
    userName: params.userName,
    friends: params.friends,
    groups: params.groups.map((g) => ({
      id: g.id,
      name: g.name,
      memberIds: g.memberIds,
      memberNames: Object.fromEntries(
        g.memberIds.map((id) => [id, params.allKnownUserNames[id] || id]),
      ),
    })),
  };
}
