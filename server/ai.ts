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
  // If THIS past message had receipts attached, the verbatim text transcription
  // is stored here and replayed into Claude's context every turn. The actual
  // file bytes were discarded after the upload turn — this text is the only
  // record of what the receipt said.
  attachmentContext?: string | null;
}

/**
 * Attachment passed to the transcription pipeline. We never persist the actual
 * `base64` bytes — the buffer lives in memory for one request, gets sent to
 * Anthropic (and/or pdf-parse), and is discarded as soon as the response
 * returns. The message's audit row in Postgres only records metadata
 * (filename, mime, size) for transcript display — NOT the contents.
 *
 * NOTE: AiAttachment is consumed by server/receiptTranscription.ts, not by
 * runAiTurn directly. The route handler transcribes attachments FIRST, then
 * passes only the verbatim text to runAiTurn. This keeps runAiTurn pure
 * text-in-text-out and makes it easy to replay attachment context in history.
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

## HANDLING RECEIPTS

When a user attaches a receipt (PDF or image), the server transcribes it BEFORE you see the conversation. The verbatim transcription is injected into the user's message under a "RECEIPT CONTEXT" header. You will see something like:

\`\`\`
RECEIPT CONTEXT (verbatim transcription of attached file(s)):
<every line of the receipt, exactly as printed>

USER MESSAGE:
<what the user actually typed>
\`\`\`

How to use it:

A. **Treat RECEIPT CONTEXT as the authoritative reference.** Every amount, item, tax line, and annotation (unavailable, refunded, comp'd, etc.) you need is in there. Don't ever ask the user for amounts you can read from the RECEIPT CONTEXT — compute the splits yourself.

B. **The same RECEIPT CONTEXT is replayed in every future turn of this conversation** (the server inlines it from history). So a follow-up like "change the milk to split with Krish only" still has the receipt available — go look at the RECEIPT CONTEXT block on the earlier user message and act from there.

C. **Propose splits immediately when participants are clear.** Don't ask clarifying questions when you can make a reasonable proposal from the context: the user's text, prior turns, the group/friend list, and the receipt content. Only call ask_clarification for genuine ambiguity (e.g., two friends with the same first name).

D. **If you're asked about a receipt but no RECEIPT CONTEXT appears anywhere in the conversation**, tell the user the receipt wasn't captured and ask them to re-attach it. (This shouldn't happen — the transcription pipeline runs on every upload — but be honest if it does.)

## CRITICAL RULES

1. **Never invent user IDs.** Only use IDs from the friends + groups context above. If a name doesn't match, use ask_clarification.

2. **Default to the current user as the payer** unless the user clearly says someone else paid (e.g., "Krish bought lunch for me", "she covered the bill").

3. **Default to equal splits** unless the user specifies otherwise.

4. **Currency defaults to CAD** unless the user mentions one.

5. **For group expenses:** if the user names a group (e.g., "split it in our Halifax group"), match it case-insensitively in their groups list. If no group is mentioned, treat it as a direct-friend expense (no groupId).

6. **For per-item receipt splits:** use propose_multiple_expenses with one entry per assigned item.

7. **When uncertain about WHO** (name collision, ambiguous reference), call ask_clarification. NEVER guess between two friends with the same first name.

8. **When uncertain about AMOUNT or DESCRIPTION**, default reasonably and proceed — the user will edit on the proposal card if it's wrong.

9. **Keep responses BRIEF.** A one-line confirmation is enough ("Here's what I'm proposing." or "Got it — let me know if any of these need adjusting."). Don't repeat the proposal or receipt details in prose; the UI shows the proposal card, and the RECEIPT CONTEXT is the source of truth for line items.

10. **You CANNOT settle balances, delete expenses, change subscriptions, or invite users.** Stay strictly within expense-logging.

If the user asks something unrelated to expenses (jokes, support, "how do I use Spliiit"), respond briefly with text — no tool calls.`;
}

// ── Main entrypoint ──────────────────────────────────────────────────────

/**
 * Compose a user-message body that inlines RECEIPT CONTEXT (if any) above
 * the user's typed message. Used for both the current turn and replayed
 * history. Keeps the format consistent so Claude can pattern-match on the
 * "RECEIPT CONTEXT:" / "USER MESSAGE:" headers described in the system prompt.
 */
function composeUserBody(text: string, attachmentContext?: string | null): string {
  const trimmed = (text || "").trim();
  if (!attachmentContext || attachmentContext.trim().length === 0) {
    return trimmed;
  }
  const userPart = trimmed.length > 0
    ? trimmed
    : "(no text — receipt attached, parse and propose)";
  return (
    "RECEIPT CONTEXT (verbatim transcription of attached file(s)):\n" +
    attachmentContext.trim() +
    "\n\nUSER MESSAGE:\n" +
    userPart
  );
}

/**
 * Run one turn of the AI conversation. Pure text in, structured tool calls out.
 *
 * Receipt handling: the route handler runs the transcription pipeline (see
 * server/receiptTranscription.ts) BEFORE calling this function, then passes
 * the verbatim text as `newAttachmentContext`. We inline it into the current
 * turn's user message, and we also inline each prior turn's attachmentContext
 * back into its replayed history entry — so Claude sees the same RECEIPT
 * CONTEXT in every turn for the life of the conversation.
 *
 * @param ctx                   Current user's context (friends, groups, etc.)
 * @param history               Prior messages — content + optional attachmentContext per entry
 * @param newUserMessage        The user's just-typed message text
 * @param newAttachmentContext  Verbatim transcription of THIS turn's attachments, if any
 */
export async function runAiTurn(params: {
  ctx: UserContext;
  history: AiMessageInput[];
  newUserMessage: string;
  newAttachmentContext?: string | null;
}): Promise<AiTurnResult> {
  const client = getClient();
  if (!client) {
    throw new Error("AI Mode not configured — ANTHROPIC_API_KEY missing");
  }

  const { ctx, history, newUserMessage, newAttachmentContext } = params;

  // Build messages array. Truncate history to last 20 entries to avoid
  // runaway token costs — most real conversations are 2-6 turns anyway.
  // For user messages, inline any prior attachmentContext so the receipt
  // content is available in every turn, not just the upload turn.
  const trimmedHistory = history.slice(-20);
  const messages: Anthropic.MessageParam[] = trimmedHistory.map((m) => ({
    role: m.role,
    content: m.role === "user"
      ? composeUserBody(m.content, m.attachmentContext)
      : (m.content || ""),
  }));

  // Current turn — same composition, with this turn's transcription if present.
  messages.push({
    role: "user",
    content: composeUserBody(newUserMessage, newAttachmentContext),
  });

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
