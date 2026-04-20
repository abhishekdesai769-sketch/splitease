/**
 * Apple In-App Purchase helpers — RevenueCat Capacitor SDK
 *
 * Only activates when running inside a native iOS binary.
 * Safe to import on web/Android — all functions are no-ops on non-iOS platforms.
 */
import { Capacitor } from "@capacitor/core";
import { Purchases } from "@revenuecat/purchases-capacitor";

// ─── Platform detection ───────────────────────────────────────────────────────

/** True only inside the native iOS Capacitor binary */
export const isIosNative =
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";

// ─── Init ─────────────────────────────────────────────────────────────────────

const RC_IOS_KEY = import.meta.env.VITE_REVENUECAT_IOS_KEY as string | undefined;
let _initialized = false;

/**
 * Call once after the user logs in.
 * Sets the RevenueCat app_user_id to our DB user ID so that webhook events
 * arriving at /api/apple-iap/webhook can be matched back to the correct user.
 */
export async function initRevenueCat(userId: string): Promise<void> {
  if (!isIosNative || !RC_IOS_KEY || _initialized) return;
  try {
    await Purchases.configure({ apiKey: RC_IOS_KEY });
    await Purchases.logIn({ appUserID: userId });
    _initialized = true;
    console.log("[iap] RevenueCat initialized for user:", userId);
  } catch (err) {
    console.error("[iap] RevenueCat init failed:", err);
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type IAPPlan = "monthly" | "yearly";

export interface IAPResult {
  success: boolean;
  isPremium: boolean;
  /** ISO8601 date string, null for lifetime, undefined if not applicable */
  expirationDate?: string | null;
  error?: string;
  /** True when the user explicitly cancelled the App Store dialog */
  cancelled?: boolean;
}

// ─── Purchase ─────────────────────────────────────────────────────────────────

/**
 * Triggers the native StoreKit purchase sheet for the given plan.
 * Returns a typed result — never throws.
 */
export async function purchasePremium(plan: IAPPlan): Promise<IAPResult> {
  if (!isIosNative) {
    return { success: false, isPremium: false, error: "Not running on iOS native" };
  }

  try {
    const offerings = await Purchases.getOfferings();
    const current = offerings.current;
    if (!current) {
      return {
        success: false,
        isPremium: false,
        error: "No offerings available. Please check your connection and try again.",
      };
    }

    const pkg = plan === "monthly" ? current.monthly : current.annual;
    if (!pkg) {
      return {
        success: false,
        isPremium: false,
        error: `No ${plan} package configured. Please contact support.`,
      };
    }

    const { customerInfo } = await Purchases.purchasePackage({ aPackage: pkg });
    const entitlement = customerInfo.entitlements.active["premium"];

    return {
      success: !!entitlement,
      isPremium: !!entitlement,
      expirationDate: entitlement?.expirationDate ?? null,
    };
  } catch (err: any) {
    // User tapped Cancel in the App Store payment sheet — not an error
    if (err?.code === "1" || err?.userCancelled === true) {
      return { success: false, isPremium: false, cancelled: true };
    }
    console.error("[iap] purchasePremium error:", err);
    return {
      success: false,
      isPremium: false,
      error: err?.message ?? "Purchase failed. Please try again.",
    };
  }
}

// ─── Restore ──────────────────────────────────────────────────────────────────

/**
 * Restores previous purchases (required by App Store guidelines).
 * Returns a typed result — never throws.
 */
export async function restorePurchases(): Promise<IAPResult> {
  if (!isIosNative) {
    return { success: false, isPremium: false, error: "Not running on iOS native" };
  }

  try {
    const { customerInfo } = await Purchases.restorePurchases();
    const entitlement = customerInfo.entitlements.active["premium"];

    return {
      success: true,
      isPremium: !!entitlement,
      expirationDate: entitlement?.expirationDate ?? null,
    };
  } catch (err: any) {
    console.error("[iap] restorePurchases error:", err);
    return {
      success: false,
      isPremium: false,
      error: err?.message ?? "Restore failed. Please try again.",
    };
  }
}
