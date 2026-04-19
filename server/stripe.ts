import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn("[stripe] STRIPE_SECRET_KEY not set — subscription features disabled");
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_placeholder");

// Price IDs from Stripe dashboard — LIVE (CAD)
export const STRIPE_PRICE_MONTHLY = "price_1TO41pIF43gxR1xo5wpRAeB7";
export const STRIPE_PRICE_YEARLY  = "price_1TO41nIF43gxR1xoib3nLQgn";

export const STRIPE_ENABLED = !!process.env.STRIPE_SECRET_KEY;
