// Curated list of common disposable / throwaway email domains.
// Used at signup to block obvious abuse-pattern accounts.
//
// We DON'T use the npm `disposable-email-domains` package because:
//   - it's a 5k+ domain list, mostly long-tail / dead domains
//   - false positives bother legit users far more than missing the long tail
//   - we'd rather catch 90% with zero deps than 99% with a maintenance burden
//
// Add domains here when we see abuse from a specific provider. Removing is
// safe and reversible. Matching is case-insensitive on the domain only.

const DISPOSABLE_DOMAINS = new Set<string>([
  // Top-tier disposable services (the ones used in ~80% of abuse signups)
  "10minutemail.com",
  "10minutemail.net",
  "20minutemail.com",
  "tempmail.com",
  "tempmail.net",
  "tempmail.org",
  "temp-mail.org",
  "temp-mail.io",
  "tmpmail.org",
  "tmpmail.net",
  "throwawaymail.com",
  "throwaway.email",
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamail.biz",
  "guerrillamail.info",
  "guerrillamail.de",
  "sharklasers.com",
  "grr.la",
  "mailinator.com",
  "mailinator.net",
  "mailinator.org",
  "mailinator2.com",
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
  "maildrop.cc",
  "trashmail.com",
  "trashmail.net",
  "trashmail.org",
  "trashmail.de",
  "fakeinbox.com",
  "fakemail.net",
  "fakemailgenerator.com",
  "dispostable.com",
  "moakt.com",
  "spamgourmet.com",
  "mintemail.com",
  "spambox.us",
  "spamfree24.org",
  "mytemp.email",
  "tempinbox.com",
  "tempr.email",
  "discard.email",
  "emailondeck.com",
  "getairmail.com",
  "luxusmail.org",
  "mailcatch.com",
  "mailnesia.com",
  "mailnull.com",
  "mintemail.com",
  "myrambler.ru",  // common Russian abuse pattern
  "rambler.ru",
  "tempemail.com",
  "tempinbox.co.uk",
  "tempmailer.com",
  "tempymail.com",
  "throwam.com",
  "trbvm.com",
  "wegwerfemail.de",
  "wegwerfmail.de",
  "wegwerfmail.net",
  "wegwerfmail.info",
  "wegwerfmail.org",
  "fakeemail.de",
  "spam4.me",
]);

/**
 * Returns true if the email's domain is on our disposable-provider blocklist.
 * Returns false for malformed emails (validation happens upstream — we
 * don't want to double-error and confuse the user).
 */
export function isDisposableEmail(email: string): boolean {
  if (!email || typeof email !== "string") return false;
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return DISPOSABLE_DOMAINS.has(domain);
}
