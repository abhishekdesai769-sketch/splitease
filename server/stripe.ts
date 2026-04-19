import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn("[stripe] STRIPE_SECRET_KEY not set — subscription features disabled");
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_placeholder", {
  apiVersion: "2025-03-31.basil",
});

// Price IDs from Stripe dashboard (CAD)
export const STRIPE_PRICE_MONTHLY = "price_1TO38WIfVeN2sZv7qXvvIVNc";
export const STRIPE_PRICE_YEARLY  = "price_1TO3ArIfVeN2sZv7wNDdFrsC";

export const STRIPE_ENABLED = !!process.env.STRIPE_SECRET_KEY;
