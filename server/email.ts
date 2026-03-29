import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM_ADDRESS = "Spliiit <spliiit@klarityit.ca>";

// Inline logo for email templates — HTML table-based since email clients don't support SVG.
// Renders the icon (three lines split by a dashed line) + "Spliiit" text.
const EMAIL_LOGO = `
<table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">
  <tr>
    <td style="vertical-align:middle;padding-right:10px;">
      <table cellpadding="0" cellspacing="0" border="0" style="width:36px;height:36px;border-radius:8px;background-color:rgba(45,212,168,0.12);" role="img" aria-label="Spliiit logo">
        <tr><td style="padding:6px 5px;position:relative;">
          <table cellpadding="0" cellspacing="0" border="0" style="width:100%;">
            <tr>
              <td style="width:48%;height:0;border-top:2px solid #2dd4a8;font-size:0;line-height:0;">&nbsp;</td>
              <td style="width:2px;background-color:#2dd4a8;font-size:0;line-height:0;">&nbsp;</td>
              <td style="height:0;border-top:2px solid #2dd4a8;font-size:0;line-height:0;">&nbsp;</td>
            </tr>
            <tr>
              <td style="height:3px;font-size:0;line-height:0;">&nbsp;</td>
              <td style="width:2px;background-color:#2dd4a8;font-size:0;line-height:0;">&nbsp;</td>
              <td style="height:3px;font-size:0;line-height:0;">&nbsp;</td>
            </tr>
            <tr>
              <td style="height:0;border-top:2px solid #2dd4a8;font-size:0;line-height:0;">&nbsp;</td>
              <td style="width:2px;background-color:#2dd4a8;font-size:0;line-height:0;">&nbsp;</td>
              <td style="height:0;border-top:2px solid #2dd4a8;font-size:0;line-height:0;">&nbsp;</td>
            </tr>
            <tr>
              <td style="height:3px;font-size:0;line-height:0;">&nbsp;</td>
              <td style="width:2px;background-color:#2dd4a8;font-size:0;line-height:0;">&nbsp;</td>
              <td style="height:3px;font-size:0;line-height:0;">&nbsp;</td>
            </tr>
            <tr>
              <td style="height:0;border-top:2px solid #2dd4a8;font-size:0;line-height:0;">&nbsp;</td>
              <td style="width:2px;background-color:#2dd4a8;font-size:0;line-height:0;">&nbsp;</td>
              <td style="height:0;border-top:2px solid #2dd4a8;font-size:0;line-height:0;">&nbsp;</td>
            </tr>
          </table>
        </td></tr>
      </table>
    </td>
    <td style="vertical-align:middle;">
      <span style="font-size:18px;font-weight:700;color:#1a1a1a;letter-spacing:-0.3px;">Spl</span><span style="font-size:18px;font-weight:700;color:#2dd4a8;letter-spacing:-0.3px;">iii</span><span style="font-size:18px;font-weight:700;color:#1a1a1a;letter-spacing:-0.3px;">t</span>
    </td>
  </tr>
</table>
`;

const EMAIL_FOOTER = `Spliiit &middot; Expense splitting made easy`;

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
 * Send OTP code for email verification
 */
export async function sendOtpEmail(to: string, name: string, code: string) {
  if (!resend) return;

  const subject = `${code} is your Spliiit verification code`;

  const html = `
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <tr><td align="center" style="padding:24px 16px;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:520px;">
      <tr><td>
        ${EMAIL_LOGO}
      </td></tr>
      <tr><td style="font-size:15px;color:#374151;padding-bottom:16px;">
        Hi ${name},
      </td></tr>
      <tr><td style="font-size:15px;color:#374151;padding-bottom:16px;">
        Your verification code is:
      </td></tr>
      <tr><td style="padding-bottom:16px;">
        <table cellpadding="0" cellspacing="0" role="presentation" style="border:1px solid #e5e7eb;border-radius:10px;">
          <tr><td style="padding:16px 32px;font-size:32px;font-weight:700;color:#111827;letter-spacing:8px;font-family:monospace;">
            ${code}
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="font-size:14px;color:#6b7280;padding-bottom:24px;">
        This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.
      </td></tr>
      <tr><td style="border-top:1px solid #f3f4f6;padding-top:16px;font-size:12px;color:#9ca3af;">
        ${EMAIL_FOOTER}
      </td></tr>
    </table>
  </td></tr>
</table>`;

  const text = `Hi ${name},\n\nYour Spliiit verification code is: ${code}\n\nThis code expires in 10 minutes.\n\n— Spliiit`;

  sendEmail(to, subject, html, text);
}

/**
 * Send password reset email
 */
export async function sendResetPasswordEmail(to: string, name: string, resetLink: string) {
  if (!resend) return;

  const subject = `Reset your Spliiit password`;

  const html = `
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <tr><td align="center" style="padding:24px 16px;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:520px;">
      <tr><td>
        ${EMAIL_LOGO}
      </td></tr>
      <tr><td style="font-size:15px;color:#374151;padding-bottom:16px;">
        Hi ${name},
      </td></tr>
      <tr><td style="font-size:15px;color:#374151;padding-bottom:16px;">
        We received a request to reset your password. Click the link below to set a new one:
      </td></tr>
      <tr><td style="padding-bottom:16px;">
        <a href="${resetLink}" style="font-size:14px;color:#2dd4a8;text-decoration:none;font-weight:500;">${resetLink}</a>
      </td></tr>
      <tr><td style="font-size:14px;color:#6b7280;padding-bottom:24px;">
        This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email.
      </td></tr>
      <tr><td style="border-top:1px solid #f3f4f6;padding-top:16px;font-size:12px;color:#9ca3af;">
        ${EMAIL_FOOTER}
      </td></tr>
    </table>
  </td></tr>
</table>`;

  const text = `Hi ${name},\n\nWe received a request to reset your password. Visit this link to set a new one:\n\n${resetLink}\n\nThis link expires in 1 hour.\n\n— Spliiit`;

  sendEmail(to, subject, html, text);
}

/**
 * Send CSV data export to user via email
 */
export async function sendExportEmail(to: string, name: string, csvContent: string, scope: string) {
  if (!resend) return;

  const scopeLabel = scope === "all" ? "All Expenses" : scope;
  const dateStr = new Date().toISOString().split("T")[0];
  const filename = `spliiit-${scope.toLowerCase().replace(/\s+/g, "-")}-${dateStr}.csv`;

  const subject = `Your Spliiit export: ${scopeLabel}`;

  const html = `
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <tr><td align="center" style="padding:24px 16px;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:520px;">
      <tr><td>
        ${EMAIL_LOGO}
      </td></tr>
      <tr><td style="font-size:15px;color:#374151;padding-bottom:16px;">
        Hi ${name},
      </td></tr>
      <tr><td style="font-size:15px;color:#374151;padding-bottom:16px;">
        Your expense export for <strong>${scopeLabel}</strong> is attached as a CSV file.
      </td></tr>
      <tr><td style="font-size:14px;color:#6b7280;padding-bottom:24px;">
        Open the attached CSV in Excel, Google Sheets, or any spreadsheet app.
      </td></tr>
      <tr><td style="border-top:1px solid #f3f4f6;padding-top:16px;font-size:12px;color:#9ca3af;">
        ${EMAIL_FOOTER}
      </td></tr>
    </table>
  </td></tr>
</table>`;

  const text = `Hi ${name},\n\nYour expense export for ${scopeLabel} is attached as a CSV file.\n\nOpen the attached CSV in Excel, Google Sheets, or any spreadsheet app.\n\n— Spliiit`;

  const attachments = [
    { content: Buffer.from(csvContent, "utf-8"), filename },
  ];

  await sendEmail(to, subject, html, text, attachments);
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

  const hasReceipt = receiptBuffer && receiptFilename;

  for (const person of splitAmong) {
    // Don't email the payer about their own expense
    if (person.email === opts.paidByEmail) continue;

    const subject = isSettlement
      ? `${paidByName} settled up with you${groupName ? ` in ${groupName}` : ""}`
      : `${paidByName} added an expense: ${description}${groupName ? ` in ${groupName}` : ""}`;

    const receiptLine = hasReceipt
      ? `<tr><td style="padding:12px 0 0;font-size:13px;color:#6b7280;">Receipt attached to this email.</td></tr>`
      : "";

    // Modern transactional email — styled like a bank/Venmo notification.
    // Key rules to stay in Primary: no big CTA buttons, no full-width colored
    // backgrounds, keep HTML-to-text ratio balanced, include plain text alt.
    const html = `
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <tr><td align="center" style="padding:24px 16px;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:520px;">
      <!-- Logo -->
      <tr><td>
        ${EMAIL_LOGO}
      </td></tr>
      <!-- Greeting -->
      <tr><td style="font-size:15px;color:#374151;padding-bottom:16px;">
        Hi ${person.name},
      </td></tr>
      <!-- Amount card — light border, no heavy background -->
      <tr><td style="padding-bottom:16px;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border:1px solid #e5e7eb;border-radius:10px;">
          <tr><td style="padding:16px;">
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
              <tr>
                <td style="font-size:13px;color:#6b7280;padding-bottom:4px;">
                  ${isSettlement ? "Settlement" : description}${groupName ? ` &middot; ${groupName}` : ""}
                </td>
              </tr>
              <tr>
                <td style="font-size:28px;font-weight:700;color:#111827;padding-bottom:8px;">
                  $${amount.toFixed(2)}
                </td>
              </tr>
              <tr>
                <td style="font-size:14px;color:#374151;">
                  ${isSettlement
                    ? `<strong>${paidByName}</strong> settled up with you.`
                    : `Paid by <strong>${paidByName}</strong> &middot; Your share: <strong style="color:#2dd4a8;">$${person.share.toFixed(2)}</strong>`
                  }
                </td>
              </tr>
              ${receiptLine}
            </table>
          </td></tr>
        </table>
      </td></tr>
      <!-- Link -->
      <tr><td style="padding-bottom:24px;">
        <a href="https://splitease-81re.onrender.com" style="font-size:14px;color:#2dd4a8;text-decoration:none;font-weight:500;">View on Spliiit &rarr;</a>
      </td></tr>
      <!-- Footer -->
      <tr><td style="border-top:1px solid #f3f4f6;padding-top:16px;font-size:12px;color:#9ca3af;">
        You received this because an expense was added involving you on Spliiit.
      </td></tr>
    </table>
  </td></tr>
</table>`;

    const attachments = hasReceipt
      ? [{ content: receiptBuffer, filename: receiptFilename }]
      : undefined;

    // Plain text version — helps avoid Gmail Promotions filter
    const text = isSettlement
      ? `Hi ${person.name},\n\n${paidByName} has settled up $${amount.toFixed(2)} with you${groupName ? ` in ${groupName}` : ""}.\n\nView details at https://splitease-81re.onrender.com\n\n— Spliiit`
      : `Hi ${person.name},\n\n${paidByName} paid $${amount.toFixed(2)} for ${description}${groupName ? ` in ${groupName}` : ""}.\nYour share: $${person.share.toFixed(2)}${hasReceipt ? "\n\nReceipt is attached to this email." : ""}\n\nView details at https://splitease-81re.onrender.com\n\n— Spliiit`;

    // Fire-and-forget — don't block the API response
    sendEmail(person.email, subject, html, text, attachments);
  }
}

/**
 * Forward a support request to the Spliiit support mailbox
 */
export async function sendSupportEmail(opts: {
  fromName: string;
  fromEmail: string;
  subject: string;
  message: string;
  userId?: string;
}) {
  if (!resend) return;

  const { fromName, fromEmail, subject, message, userId } = opts;
  const SUPPORT_EMAIL = "spliiit@klarityit.ca";

  const html = `
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <tr><td align="center" style="padding:24px 16px;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:520px;">
      <tr><td>
        ${EMAIL_LOGO}
      </td></tr>
      <tr><td style="font-size:13px;color:#6b7280;padding-bottom:8px;">
        Support request from <strong style="color:#111827;">${fromName}</strong> &lt;${fromEmail}&gt;${userId ? ` (ID: ${userId})` : ""}
      </td></tr>
      <tr><td style="padding-bottom:16px;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border:1px solid #e5e7eb;border-radius:10px;">
          <tr><td style="padding:16px;">
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
              <tr>
                <td style="font-size:16px;font-weight:600;color:#111827;padding-bottom:8px;">
                  ${subject}
                </td>
              </tr>
              <tr>
                <td style="font-size:14px;color:#374151;white-space:pre-wrap;">
                  ${message.replace(/</g, "&lt;").replace(/>/g, "&gt;")}
                </td>
              </tr>
            </table>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="font-size:13px;color:#6b7280;">
        Reply directly to this email to respond to the user.
      </td></tr>
      <tr><td style="border-top:1px solid #f3f4f6;padding-top:16px;margin-top:16px;font-size:12px;color:#9ca3af;">
        ${EMAIL_FOOTER}
      </td></tr>
    </table>
  </td></tr>
</table>`;

  const text = `Support request from ${fromName} <${fromEmail}>${userId ? ` (ID: ${userId})` : ""}\n\nSubject: ${subject}\n\n${message}\n\n— Spliiit Support System`;

  // Send to support inbox with reply-to set to user's email
  await sendEmail(SUPPORT_EMAIL, `[Support] ${subject}`, html, text);
}

/**
 * Notify the invitee that someone wants to add them to a group
 */
export async function sendInviteToInviteeEmail(opts: {
  inviteeName: string;
  inviteeEmail: string;
  inviterName: string;
  groupName: string;
}) {
  if (!resend) return;
  const { inviteeName, inviteeEmail, inviterName, groupName } = opts;
  const APP_URL = "https://splitease-81re.onrender.com";

  const subject = `${inviterName} invited you to join ${groupName} on Spliiit`;

  const html = `
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <tr><td align="center" style="padding:24px 16px;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:520px;">
      <tr><td>${EMAIL_LOGO}</td></tr>
      <tr><td style="font-size:15px;color:#374151;padding-bottom:16px;">
        Hi ${inviteeName},
      </td></tr>
      <tr><td style="padding-bottom:16px;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border:1px solid #e5e7eb;border-radius:10px;">
          <tr><td style="padding:16px;">
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
              <tr><td style="font-size:14px;color:#374151;">
                <strong>${inviterName}</strong> has invited you to join the group <strong>${groupName}</strong>.
              </td></tr>
              <tr><td style="font-size:13px;color:#6b7280;padding-top:8px;">
                Open Spliiit to accept or decline this invitation.
              </td></tr>
            </table>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding-bottom:24px;">
        <a href="${APP_URL}" style="font-size:14px;color:#2dd4a8;text-decoration:none;font-weight:500;">View on Spliiit &rarr;</a>
      </td></tr>
      <tr><td style="border-top:1px solid #f3f4f6;padding-top:16px;font-size:12px;color:#9ca3af;">
        ${EMAIL_FOOTER}
      </td></tr>
    </table>
  </td></tr>
</table>`;

  const text = `Hi ${inviteeName},\n\n${inviterName} has invited you to join the group "${groupName}" on Spliiit.\n\nOpen the app to accept or decline: ${APP_URL}\n\n\u2014 Spliiit`;

  sendEmail(inviteeEmail, subject, html, text);
}

/**
 * Notify the group admin(s) that a member wants to add someone
 */
export async function sendInviteToAdminEmail(opts: {
  adminName: string;
  adminEmail: string;
  inviterName: string;
  inviteeName: string;
  groupName: string;
}) {
  if (!resend) return;
  const { adminName, adminEmail, inviterName, inviteeName, groupName } = opts;
  const APP_URL = "https://splitease-81re.onrender.com";

  const subject = `${inviterName} wants to add ${inviteeName} to ${groupName}`;

  const html = `
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <tr><td align="center" style="padding:24px 16px;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:520px;">
      <tr><td>${EMAIL_LOGO}</td></tr>
      <tr><td style="font-size:15px;color:#374151;padding-bottom:16px;">
        Hi ${adminName},
      </td></tr>
      <tr><td style="padding-bottom:16px;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border:1px solid #e5e7eb;border-radius:10px;">
          <tr><td style="padding:16px;">
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
              <tr><td style="font-size:14px;color:#374151;">
                <strong>${inviterName}</strong> wants to add <strong>${inviteeName}</strong> to the group <strong>${groupName}</strong>.
              </td></tr>
              <tr><td style="font-size:13px;color:#6b7280;padding-top:8px;">
                Open Spliiit to approve or reject this request.
              </td></tr>
            </table>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding-bottom:24px;">
        <a href="${APP_URL}" style="font-size:14px;color:#2dd4a8;text-decoration:none;font-weight:500;">View on Spliiit &rarr;</a>
      </td></tr>
      <tr><td style="border-top:1px solid #f3f4f6;padding-top:16px;font-size:12px;color:#9ca3af;">
        ${EMAIL_FOOTER}
      </td></tr>
    </table>
  </td></tr>
</table>`;

  const text = `Hi ${adminName},\n\n${inviterName} wants to add ${inviteeName} to the group "${groupName}" on Spliiit.\n\nOpen the app to approve or reject: ${APP_URL}\n\n\u2014 Spliiit`;

  sendEmail(adminEmail, subject, html, text);
}

/**
 * Invite a ghost member to sign up on Spliiit
 */
export async function sendGhostInviteEmail(opts: {
  to: string;
  inviterName: string;
  ghostName: string;
  groupName: string;
}) {
  if (!resend) return;
  const { to, inviterName, ghostName, groupName } = opts;
  const APP_URL = "https://splitease-81re.onrender.com";

  const subject = `${inviterName} has been tracking expenses with you on Spliiit`;

  const html = `
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <tr><td align="center" style="padding:24px 16px;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:520px;">
      <tr><td>${EMAIL_LOGO}</td></tr>
      <tr><td style="font-size:15px;color:#374151;padding-bottom:16px;">
        Hi ${ghostName},
      </td></tr>
      <tr><td style="padding-bottom:16px;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border:1px solid #e5e7eb;border-radius:10px;">
          <tr><td style="padding:16px;">
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
              <tr><td style="font-size:14px;color:#374151;">
                <strong>${inviterName}</strong> imported expenses from Splitwise into the group <strong>${groupName}</strong>, and you're part of it!
              </td></tr>
              <tr><td style="font-size:13px;color:#6b7280;padding-top:8px;">
                Sign up on Spliiit to see your balances, settle up, and keep splitting expenses with your friends.
              </td></tr>
            </table>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding-bottom:24px;">
        <a href="${APP_URL}" style="font-size:14px;color:#2dd4a8;text-decoration:none;font-weight:500;">Sign up on Spliiit &rarr;</a>
      </td></tr>
      <tr><td style="border-top:1px solid #f3f4f6;padding-top:16px;font-size:12px;color:#9ca3af;">
        ${EMAIL_FOOTER}
      </td></tr>
    </table>
  </td></tr>
</table>`;

  const text = `Hi ${ghostName},\n\n${inviterName} imported expenses from Splitwise into the group "${groupName}" on Spliiit, and you're part of it!\n\nSign up to see your balances and settle up: ${APP_URL}\n\n— Spliiit`;

  sendEmail(to, subject, html, text);
}
