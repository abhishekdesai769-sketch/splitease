// Plaid integration — Money tab bank connections.
//
// Env-aware: PLAID_ENV controls which Plaid environment we talk to.
//   - "sandbox"     → test data only, fake banks, free, no review needed
//   - "development" → real banks, real users, free up to 100 items
//   - "production"  → real banks, no item limit, paid, requires Plaid review
//
// All four functions are no-ops (or throw a clean 503-style error) when
// PLAID_CLIENT_ID isn't set, so the app stays bootable without keys.
//
// Security note: access_tokens stored in plaid_items.access_token are
// long-lived bank-access credentials. For Production, encrypt at rest using
// a server-side key (PLAID_TOKEN_KEY env var). For Sandbox, plain storage
// is acceptable — Neon disk encryption is the floor.

import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  Products,
  CountryCode,
  type LinkTokenCreateRequest,
} from "plaid";

// Lazy singleton — initialized on first use so env-var changes mid-deploy
// pick up correctly.
let _client: PlaidApi | null = null;
let _initEnv: string | null = null;

export const PLAID_ENABLED = !!(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);

function getClient(): PlaidApi {
  if (!PLAID_ENABLED) {
    throw new Error("Plaid not configured — set PLAID_CLIENT_ID and PLAID_SECRET");
  }
  const env = (process.env.PLAID_ENV || "sandbox").toLowerCase();
  // If env changed (e.g. flipped from sandbox → production), rebuild client.
  if (_client && _initEnv === env) return _client;

  const basePath = PlaidEnvironments[env as keyof typeof PlaidEnvironments];
  if (!basePath) {
    throw new Error(`Invalid PLAID_ENV: "${env}" (expected sandbox | development | production)`);
  }

  const config = new Configuration({
    basePath,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID!,
        "PLAID-SECRET": process.env.PLAID_SECRET!,
        "Plaid-Version": "2020-09-14",
      },
    },
  });

  _client = new PlaidApi(config);
  _initEnv = env;
  return _client;
}

// ── Public surface ─────────────────────────────────────────────────────────

/**
 * Creates a short-lived Link token for a specific user. The client sends
 * this to the Plaid Link UI, which opens the bank-selection + login flow.
 *
 * `userId` is OUR user ID (used as Plaid's `client_user_id`).
 * `userName` shows in Plaid's UI as "Connecting to {appName} for {userName}".
 */
export async function createLinkToken(params: {
  userId: string;
  userName: string;
}): Promise<string> {
  const client = getClient();
  const country = (process.env.PLAID_COUNTRY_CODES || "CA,US")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean) as CountryCode[];

  const req: LinkTokenCreateRequest = {
    user: { client_user_id: params.userId },
    client_name: "Spliiit",
    products: [Products.Transactions],     // Transactions also covers balances + accounts
    country_codes: country.length > 0 ? country : [CountryCode.Ca, CountryCode.Us],
    language: "en",
    // Webhook URL — set this after we wire transaction sync. For now, omit.
    // webhook: `${process.env.APP_URL || "https://spliiit.klarityit.ca"}/api/money/webhook/plaid`,
  };

  const resp = await client.linkTokenCreate(req);
  return resp.data.link_token;
}

/**
 * Exchanges a one-time `public_token` from Plaid Link for a long-lived
 * `access_token` plus the Plaid item_id. Caller stores both in plaid_items.
 */
export async function exchangePublicToken(publicToken: string): Promise<{
  accessToken: string;
  itemId: string;
}> {
  const client = getClient();
  const resp = await client.itemPublicTokenExchange({ public_token: publicToken });
  return {
    accessToken: resp.data.access_token,
    itemId: resp.data.item_id,
  };
}

/**
 * Returns institution metadata (name, logo, etc.) for display in the UI.
 * Falls back gracefully when the call fails.
 */
export async function getInstitution(institutionId: string): Promise<{
  name: string | null;
}> {
  try {
    const client = getClient();
    const country = (process.env.PLAID_COUNTRY_CODES || "CA,US")
      .split(",")
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean) as CountryCode[];
    const resp = await client.institutionsGetById({
      institution_id: institutionId,
      country_codes: country.length > 0 ? country : [CountryCode.Ca, CountryCode.Us],
    });
    return { name: resp.data.institution.name };
  } catch (err) {
    console.error("[plaid] institutionsGetById failed:", err);
    return { name: null };
  }
}

/**
 * Fetches all accounts + balances for a given access_token. Used on initial
 * exchange to populate plaid_accounts, and later for refresh-balances flows.
 */
export async function getAccounts(accessToken: string): Promise<Array<{
  plaidAccountId: string;
  name: string;
  officialName: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  currentBalance: number | null;
  availableBalance: number | null;
  isoCurrencyCode: string | null;
  institutionId: string | null;
}>> {
  const client = getClient();
  const resp = await client.accountsBalanceGet({ access_token: accessToken });

  // institution_id lives on item, but the item is included with this endpoint
  const institutionId = resp.data.item?.institution_id ?? null;

  return resp.data.accounts.map((a) => ({
    plaidAccountId: a.account_id,
    name: a.name,
    officialName: a.official_name ?? null,
    mask: a.mask ?? null,
    type: String(a.type),
    subtype: a.subtype ? String(a.subtype) : null,
    currentBalance: a.balances?.current ?? null,
    availableBalance: a.balances?.available ?? null,
    isoCurrencyCode: a.balances?.iso_currency_code ?? null,
    institutionId,
  }));
}

/**
 * Disconnects a bank connection on Plaid's side. Caller is responsible for
 * removing the local plaid_items + plaid_accounts rows.
 */
export async function removeItem(accessToken: string): Promise<void> {
  const client = getClient();
  try {
    await client.itemRemove({ access_token: accessToken });
  } catch (err) {
    // Already removed / invalid? Log but don't propagate — we still want to
    // clean up the local rows even if Plaid's side is gone.
    console.error("[plaid] itemRemove failed:", err);
  }
}
