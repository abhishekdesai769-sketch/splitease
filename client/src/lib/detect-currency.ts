/**
 * Best-guess home currency from the device, used to set a new user's
 * defaultCurrency silently (there is no onboarding screen to ask them).
 *
 * Must only return codes the server accepts (VALID_CURRENCIES in
 * server/routes.ts). Order of signals:
 *   1. Timezone — a Canadian or Indian timezone wins outright. Catches the
 *      common case of a Canadian phone whose language is set to en-US.
 *   2. The region in the device language tag (en-GB → GBP, fr-FR → EUR).
 *      Only an explicit region counts — a bare "en" says nothing.
 *   3. CAD.
 */

const REGION_TO_CURRENCY: Record<string, string> = {
  CA: "CAD", US: "USD", GB: "GBP", AU: "AUD", IN: "INR", MX: "MXN",
  JP: "JPY", CH: "CHF", LI: "CHF", NZ: "NZD", SG: "SGD", HK: "HKD",
};

const EURO_REGIONS = [
  "AT", "BE", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR", "IE", "IT",
  "LT", "LU", "LV", "MT", "NL", "PT", "SI", "SK",
];
for (const r of EURO_REGIONS) REGION_TO_CURRENCY[r] = "EUR";

const CANADIAN_TIMEZONES = new Set([
  "America/St_Johns", "America/Halifax", "America/Moncton", "America/Glace_Bay",
  "America/Goose_Bay", "America/Toronto", "America/Montreal", "America/Nipigon",
  "America/Thunder_Bay", "America/Iqaluit", "America/Winnipeg", "America/Rankin_Inlet",
  "America/Regina", "America/Swift_Current", "America/Edmonton", "America/Cambridge_Bay",
  "America/Yellowknife", "America/Inuvik", "America/Vancouver", "America/Whitehorse",
  "America/Dawson", "America/Dawson_Creek", "America/Fort_Nelson", "America/Creston",
  "America/Atikokan", "America/Blanc-Sablon",
]);

export const FALLBACK_CURRENCY = "CAD";

export interface CurrencyGuess {
  currency: string;
  source: "timezone" | "locale" | "fallback";
  timezone: string | null;
  locale: string | null;
}

export function detectCurrency(): CurrencyGuess {
  let timezone: string | null = null;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch { /* old engine */ }

  const locale = (typeof navigator !== "undefined" && (navigator.languages?.[0] || navigator.language)) || null;

  if (timezone && CANADIAN_TIMEZONES.has(timezone)) {
    return { currency: "CAD", source: "timezone", timezone, locale };
  }
  if (timezone === "Asia/Kolkata" || timezone === "Asia/Calcutta") {
    return { currency: "INR", source: "timezone", timezone, locale };
  }

  // Explicit region only: "en-GB" → GB, "zh-Hant-HK" → HK, "en" → none.
  const region = locale?.split(/[-_]/).slice(1).find((part) => /^[A-Za-z]{2}$/.test(part))?.toUpperCase();
  if (region && REGION_TO_CURRENCY[region]) {
    return { currency: REGION_TO_CURRENCY[region], source: "locale", timezone, locale };
  }

  return { currency: FALLBACK_CURRENCY, source: "fallback", timezone, locale };
}
