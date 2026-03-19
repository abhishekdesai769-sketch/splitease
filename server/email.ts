import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM_ADDRESS = "SplitEase <splitease@klarityit.ca>";

// Silently skip if no API key configured (graceful degradation)
async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text: string,
  attachments?: { content: Buffer; filename: string }[]
) {
  if (!resend) return;
  try {
    await resend.emails.send({
      from: FROM_ADDRESS,
      to,
      subject,
      html,
      text,
      ...(attachments && attachments.length > 0
        ? { attachments: attachments.map((a) => ({ content: a.content, filename: a.filename })) }
        : {}),
    });
  } catch (err) {
    console.error("Failed to send email to", to, err);
  }
}

/**
 * Notify people involved in a new expense
 */
export async function notifyExpenseCreated(opts: {
  description: string;
  amount: number;
  paidByName: string;
  paidByEmail: string;
  splitAmong: { name: string; email: string; share: number }[];
  groupName?: string;
  isSettlement?: boolean;
  receiptBuffer?: Buffer;
  receiptFilename?: string;
}) {
  if (!resend) return;

  const { description, amount, paidByName, splitAmong, groupName, isSettlement, receiptBuffer, receiptFilename } = opts;

  const groupLabel = groupName ? ` in <strong>${groupName}</strong>` : "";
  const typeLabel = isSettlement ? "Settlement" : "Expense";
  const hasReceipt = receiptBuffer && receiptFilename;

  for (const person of splitAmong) {
    // Don't email the payer about their own expense
    if (person.email === opts.paidByEmail) continue;

    const subject = isSettlement
      ? `${paidByName} settled up with you${groupName ? ` in ${groupName}` : ""}`
      : `${paidByName} added an expense: ${description}${groupName ? ` in ${groupName}` : ""}`;

    const receiptLine = hasReceipt
      ? `<p style="margin: 8px 0 0; font-size: 14px; color: #555;">Receipt is attached to this email.</p>`
      : "";

    // Plain, personal-style email — avoids Gmail Promotions filter.
    // No background colors, no CTA buttons, no marketing layout.
    const html = isSettlement
      ? `<p>Hi ${person.name},</p>
<p><strong>${paidByName}</strong> has settled up <strong>$${amount.toFixed(2)}</strong> with you${groupLabel}.</p>
<p style="font-size: 14px; color: #555;">View details at <a href="https://splitease-81re.onrender.com">splitease-81re.onrender.com</a></p>
<p style="font-size: 12px; color: #999; margin-top: 24px;">— SplitEase</p>`
      : `<p>Hi ${person.name},</p>
<p><strong>${paidByName}</strong> paid <strong>$${amount.toFixed(2)}</strong> for <strong>${description}</strong>${groupLabel}.</p>
<p>Your share: <strong>$${person.share.toFixed(2)}</strong></p>
${receiptLine}
<p style="font-size: 14px; color: #555; margin-top: 16px;">View details at <a href="https://splitease-81re.onrender.com">splitease-81re.onrender.com</a></p>
<p style="font-size: 12px; color: #999; margin-top: 24px;">— SplitEase</p>`;

    const attachments = hasReceipt
      ? [{ content: receiptBuffer, filename: receiptFilename }]
      : undefined;

    // Plain text version — helps avoid Gmail Promotions filter
    const text = isSettlement
      ? `Hi ${person.name},\n\n${paidByName} has settled up $${amount.toFixed(2)} with you${groupName ? ` in ${groupName}` : ""}.\n\nView details at https://splitease-81re.onrender.com\n\n— SplitEase`
      : `Hi ${person.name},\n\n${paidByName} paid $${amount.toFixed(2)} for ${description}${groupName ? ` in ${groupName}` : ""}.\nYour share: $${person.share.toFixed(2)}${hasReceipt ? "\n\nReceipt is attached to this email." : ""}\n\nView details at https://splitease-81re.onrender.com\n\n— SplitEase`;

    // Fire-and-forget — don't block the API response
    sendEmail(person.email, subject, html, text, attachments);
  }
}
