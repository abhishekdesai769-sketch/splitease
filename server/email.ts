import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

// Silently skip if no API key configured (graceful degradation)
async function sendEmail(to: string, subject: string, html: string) {
  if (!resend) return;
  try {
    await resend.emails.send({
      from: "SplitEase <onboarding@resend.dev>",
      to,
      subject,
      html,
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
}) {
  if (!resend) return;

  const { description, amount, paidByName, splitAmong, groupName, isSettlement } = opts;

  const groupLabel = groupName ? ` in <strong>${groupName}</strong>` : "";
  const typeLabel = isSettlement ? "Settlement" : "Expense";

  for (const person of splitAmong) {
    // Don't email the payer about their own expense
    if (person.email === opts.paidByEmail) continue;

    const subject = isSettlement
      ? `💸 ${paidByName} settled up with you${groupName ? ` in ${groupName}` : ""}`
      : `💰 New expense: ${description}${groupName ? ` in ${groupName}` : ""}`;

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <div style="background: #0f1419; border-radius: 12px; padding: 24px; color: #e7e9ea;">
          <h2 style="margin: 0 0 16px; color: #2dd4a8; font-size: 18px;">
            ${isSettlement ? "💸 Settlement Recorded" : "💰 New Expense Added"}
          </h2>
          
          <div style="background: #1a2028; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
            <p style="margin: 0 0 8px; color: #8899a6; font-size: 13px;">
              ${typeLabel}${groupLabel}
            </p>
            <p style="margin: 0 0 4px; font-size: 16px; font-weight: 600; color: #e7e9ea;">
              ${isSettlement ? "Settlement payment" : description}
            </p>
            <p style="margin: 0; font-size: 24px; font-weight: 700; color: #2dd4a8;">
              $${amount.toFixed(2)}
            </p>
          </div>

          <div style="background: #1a2028; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
            ${isSettlement ? `
              <p style="margin: 0; color: #e7e9ea; font-size: 14px;">
                <strong>${paidByName}</strong> has settled up <strong>$${amount.toFixed(2)}</strong> with you.
              </p>
            ` : `
              <p style="margin: 0 0 8px; color: #e7e9ea; font-size: 14px;">
                <strong>${paidByName}</strong> paid <strong>$${amount.toFixed(2)}</strong>
              </p>
              <p style="margin: 0; color: #ff6b6b; font-size: 14px; font-weight: 600;">
                Your share: $${person.share.toFixed(2)}
              </p>
            `}
          </div>

          <a href="https://splitease-81re.onrender.com" 
             style="display: block; text-align: center; background: #2dd4a8; color: #0f1419; padding: 12px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
            Open SplitEase
          </a>
        </div>
        
        <p style="text-align: center; color: #8899a6; font-size: 11px; margin-top: 16px;">
          You're receiving this because someone added an expense involving you on SplitEase.
        </p>
      </div>
    `;

    // Fire-and-forget — don't block the API response
    sendEmail(person.email, subject, html);
  }
}
