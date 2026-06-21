/**
 * Web landing — app-first marketing page for COLD logged-out web visitors.
 *
 * Sleek dark + teal aesthetic (matches the app). Part of the "smart nudge"
 * web→app strategy. Shown ONLY to cold web visitors — NOT the native app
 * (TWA/iOS), installed PWA, invite-origin signups, or anyone who taps "Sign in"
 * (they all fall straight through to AuthPage, which is untouched).
 */

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { isInTWA } from "@/lib/platform";
import { isIosNative } from "@/lib/iap";
import AuthPage from "@/pages/auth";
import { Star, Download, ScanLine, Bell, Users, Check } from "lucide-react";

const APP_STORE_URL = "https://apps.apple.com/app/spliiit/id6761338254";
const PLAY_URL = "https://play.google.com/store/apps/details?id=ca.klarityit.spliiit&pcampaignid=web_share";

type OS = "ios" | "android" | "other";

function isStandalonePWA(): boolean {
  try {
    return (window.matchMedia?.("(display-mode: standalone)")?.matches ?? false)
      || (navigator as any).standalone === true;
  } catch {
    return false;
  }
}
function detectOS(): OS {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "other";
}

// ── shared bits ─────────────────────────────────────────────────────────
function StoreButtons({ os }: { os: OS }) {
  const primary = "flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-semibold text-sm bg-teal-400 text-[#06100e] hover:bg-teal-300 active:scale-[0.98] transition";
  const secondary = "flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-semibold text-sm bg-white/[0.06] border border-white/10 text-white hover:bg-white/10 active:scale-[0.98] transition";
  return (
    <div className="flex flex-col sm:flex-row gap-3 w-full max-w-md mx-auto md:mx-0">
      <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer" className={os === "android" ? secondary : primary}>
        <Download className="w-4 h-4" /> App Store
      </a>
      <a href={PLAY_URL} target="_blank" rel="noopener noreferrer" className={os === "android" ? primary : secondary}>
        <Download className="w-4 h-4" /> Google Play
      </a>
    </div>
  );
}

function Reveal({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, delay, ease: [0.21, 0.47, 0.32, 0.98] }}
    >
      {children}
    </motion.div>
  );
}

// ── hero phone mockup (CSS-rendered app UI) ──────────────────────────────
function PhoneMock({ float }: { float: boolean }) {
  const rows: Array<[string, string, string, boolean]> = [
    ["🍕", "Pizza night", "-$18.50", false],
    ["🛒", "Costco run", "+$31.00", true],
    ["✈️", "Flights to NYC", "+$29.50", true],
  ];
  return (
    <div className="relative">
      <div className="absolute inset-0 -z-10 bg-teal-500/25 blur-[80px] rounded-full" />
      <motion.div
        animate={float ? { y: [0, -12, 0] } : undefined}
        transition={float ? { duration: 6, repeat: Infinity, ease: "easeInOut" } : undefined}
        className="relative w-[268px] h-[552px] rounded-[44px] bg-[#0d1412] border border-white/10 p-3 shadow-2xl shadow-teal-500/10"
      >
        <div className="relative w-full h-full rounded-[34px] bg-gradient-to-b from-[#0b1311] to-[#0a0f0e] overflow-hidden">
          <div className="absolute top-2.5 left-1/2 -translate-x-1/2 w-20 h-5 bg-black/80 rounded-full" />
          <div className="pt-10 px-4">
            <p className="text-[11px] text-zinc-500">Total balance</p>
            <p className="text-3xl font-bold text-teal-400 leading-tight">+$42.00</p>
            <p className="text-[11px] text-zinc-500 mb-4">you're owed</p>
            <div className="space-y-2">
              {rows.map(([emoji, label, amt, isIn]) => (
                <div key={label} className="flex items-center gap-2.5 rounded-xl bg-white/[0.04] border border-white/5 px-3 py-2.5">
                  <span className="text-base">{emoji}</span>
                  <span className="flex-1 text-xs text-zinc-200 truncate">{label}</span>
                  <span className={`text-xs font-semibold font-mono ${isIn ? "text-teal-400" : "text-rose-400"}`}>{amt}</span>
                </div>
              ))}
            </div>
            <div className="mt-3.5 rounded-xl border border-teal-500/30 bg-teal-500/10 p-3 flex items-center gap-2">
              <ScanLine className="w-4 h-4 text-teal-400 shrink-0" />
              <span className="text-[11px] text-zinc-200">Reading receipt… <span className="text-teal-400">3 items found</span></span>
            </div>
          </div>
        </div>
      </motion.div>

      {/* floating glass chips */}
      <motion.div
        animate={float ? { y: [0, 8, 0] } : undefined}
        transition={float ? { duration: 5, repeat: Infinity, ease: "easeInOut" } : undefined}
        className="absolute -left-5 top-24 hidden sm:flex items-center gap-2 rounded-xl bg-[#0d1412]/90 backdrop-blur border border-white/10 px-3 py-2 shadow-xl"
      >
        <Check className="w-3.5 h-3.5 text-teal-400" />
        <span className="text-[11px] text-zinc-200">Sarah paid you $20</span>
      </motion.div>
      <motion.div
        animate={float ? { y: [0, -10, 0] } : undefined}
        transition={float ? { duration: 7, repeat: Infinity, ease: "easeInOut" } : undefined}
        className="absolute -right-3 bottom-28 hidden sm:flex items-center gap-2 rounded-xl bg-[#0d1412]/90 backdrop-blur border border-white/10 px-3 py-2 shadow-xl"
      >
        <ScanLine className="w-3.5 h-3.5 text-teal-400" />
        <span className="text-[11px] text-zinc-200">Receipt scanned ✓</span>
      </motion.div>
    </div>
  );
}

// ── feature section ──────────────────────────────────────────────────────
function FeatureRow({
  icon: Icon, kicker, title, body, mock, flip,
}: {
  icon: typeof ScanLine; kicker: string; title: string; body: string; mock: React.ReactNode; flip?: boolean;
}) {
  return (
    <Reveal className="max-w-6xl mx-auto px-5 py-14 md:py-20">
      <div className="md:grid md:grid-cols-2 md:gap-14 md:items-center">
        <div className={flip ? "md:order-2" : ""}>
          <div className="inline-flex items-center gap-2 text-teal-400 text-sm font-semibold mb-3">
            <Icon className="w-4 h-4" /> {kicker}
          </div>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight leading-tight">{title}</h2>
          <p className="mt-4 text-zinc-400 text-base md:text-lg max-w-md">{body}</p>
        </div>
        <div className={`mt-8 md:mt-0 flex justify-center ${flip ? "md:order-1" : ""}`}>{mock}</div>
      </div>
    </Reveal>
  );
}

function MockCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative w-full max-w-sm">
      <div className="absolute inset-0 -z-10 bg-teal-500/10 blur-3xl rounded-full" />
      <div className="rounded-2xl bg-[#0d1412] border border-white/10 p-4 shadow-2xl shadow-black/40">{children}</div>
    </div>
  );
}

function Landing({ onSignIn }: { onSignIn: () => void }) {
  const os = detectOS();
  const reduce = useReducedMotion();

  return (
    <div className="relative min-h-screen bg-[#0a0f0e] text-white overflow-x-hidden" style={{ fontFamily: "Satoshi, Inter, system-ui, sans-serif" }}>
      {/* background glows */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-48 left-1/2 -translate-x-1/2 w-[700px] h-[700px] rounded-full bg-teal-500/15 blur-[130px]" />
        <div className="absolute top-1/2 -right-48 w-[420px] h-[420px] rounded-full bg-emerald-400/[0.07] blur-[110px]" />
      </div>

      {/* nav */}
      <nav className="sticky top-0 z-40 backdrop-blur-md bg-[#0a0f0e]/70 border-b border-white/5">
        <div className="max-w-6xl mx-auto px-5 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold">
            <img src="/icon-192.png" alt="" className="w-7 h-7 rounded-lg" />
            <span>Spl<span className="text-teal-400">iii</span>t</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={onSignIn} className="text-sm text-zinc-400 hover:text-white px-3 py-1.5 rounded-lg transition">Sign in</button>
            <a href={os === "android" ? PLAY_URL : APP_STORE_URL} target="_blank" rel="noopener noreferrer"
               className="text-sm font-semibold bg-teal-400 text-[#06100e] px-3.5 py-1.5 rounded-lg hover:bg-teal-300 transition">Get the app</a>
          </div>
        </div>
      </nav>

      <main className="relative">
        {/* hero */}
        <section className="max-w-6xl mx-auto px-5 pt-14 pb-16 md:pt-24 md:pb-24 md:grid md:grid-cols-2 md:gap-10 md:items-center">
          <div className="text-center md:text-left">
            <Reveal>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-white/10 bg-white/[0.04] text-xs text-zinc-300 mb-6">
                <Star className="w-3.5 h-3.5 text-teal-400 fill-teal-400" /> 4.8 rating · Free on iOS &amp; Android
              </div>
            </Reveal>
            <Reveal delay={0.05}>
              <h1 className="text-[2.6rem] leading-[1.04] md:text-6xl font-bold tracking-tight">
                Snap the receipt.<br /><span className="text-teal-400">We'll do the math.</span>
              </h1>
            </Reveal>
            <Reveal delay={0.1}>
              <p className="mt-5 text-lg text-zinc-400 max-w-md mx-auto md:mx-0">
                Spliiit splits bills with friends and groups in seconds — and its AI reads your receipts, so you never type an expense again.
              </p>
            </Reveal>
            <Reveal delay={0.15}>
              <div className="mt-8"><StoreButtons os={os} /></div>
              <button onClick={onSignIn} className="mt-4 text-sm text-zinc-500 hover:text-zinc-300 underline underline-offset-4 transition">
                Prefer the browser? Sign in
              </button>
            </Reveal>
          </div>
          <div className="mt-16 md:mt-0 flex justify-center">
            <PhoneMock float={!reduce} />
          </div>
        </section>

        {/* proof strip */}
        <Reveal>
          <div className="max-w-5xl mx-auto px-5">
            <div className="flex flex-wrap justify-center gap-x-10 gap-y-4 py-7 border-y border-white/5 text-center">
              {[
                ["★ 4.8", "App Store rating"],
                ["1,000+", "splitting bills"],
                ["$0", "splitting free forever"],
                ["iOS + Android", "no ads, ever"],
              ].map(([big, small]) => (
                <div key={small}>
                  <p className="text-xl font-bold text-white">{big}</p>
                  <p className="text-xs text-zinc-500">{small}</p>
                </div>
              ))}
            </div>
          </div>
        </Reveal>

        {/* features */}
        <FeatureRow
          icon={ScanLine}
          kicker="AI receipts"
          title="Stop typing in expenses."
          body="Snap a photo — or drop a PDF receipt — and Spliiit reads every line item and splits it for you. The only expense app that actually reads PDFs."
          mock={
            <MockCard>
              <div className="flex items-center gap-2 mb-3 text-teal-400 text-xs font-semibold"><ScanLine className="w-4 h-4" /> Receipt scanned</div>
              {[["Margherita pizza", "$18.00"], ["Garlic bread", "$7.50"], ["2× Sodas", "$6.00"]].map(([n, p]) => (
                <div key={n} className="flex justify-between py-1.5 border-b border-white/5 text-sm">
                  <span className="text-zinc-300">{n}</span><span className="font-mono text-zinc-400">{p}</span>
                </div>
              ))}
              <div className="mt-3 flex items-center justify-between rounded-lg bg-teal-500/10 border border-teal-500/20 px-3 py-2">
                <span className="text-xs text-zinc-300">Split 3 ways</span>
                <span className="text-sm font-semibold text-teal-400">$10.50 each</span>
              </div>
            </MockCard>
          }
        />

        <FeatureRow
          icon={Bell}
          flip
          kicker="Auto-reminders"
          title="Get paid back, awkward-free."
          body="Spliiit nudges your friends for you — friendly, firm, or funny, you pick the tone. The money lands without you ever sending the 'hey, you still owe me' text."
          mock={
            <MockCard>
              <div className="flex items-center gap-2 mb-3"><Bell className="w-4 h-4 text-teal-400" /><span className="text-xs text-zinc-400">Reminder sent to Alex</span></div>
              <div className="rounded-xl bg-white/[0.04] border border-white/5 p-3 text-sm text-zinc-300 leading-relaxed">
                "Hey Alex 👋 friendly nudge — you owe <span className="text-teal-400 font-semibold">$24.00</span> from the ski trip. Settle up in 2 taps?"
              </div>
              <div className="mt-3 flex gap-2">
                <span className="text-[11px] px-2 py-1 rounded-full bg-white/5 text-zinc-400">Friendly</span>
                <span className="text-[11px] px-2 py-1 rounded-full bg-white/5 text-zinc-400">Firm</span>
                <span className="text-[11px] px-2 py-1 rounded-full bg-teal-500/15 text-teal-400 border border-teal-500/20">Funny ✓</span>
              </div>
            </MockCard>
          }
        />

        <FeatureRow
          icon={Users}
          kicker="Groups & trips"
          title="One tab for the whole crew."
          body="Trips, roommates, dinners — everyone adds expenses, Spliiit untangles who owes who, and settles it down to the fewest possible payments."
          mock={
            <MockCard>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-white">🏔️ Whistler trip</span>
                <span className="text-xs text-zinc-500">4 people</span>
              </div>
              {[["You", "+$120", true], ["Sarah", "-$45", false], ["Alex", "-$40", false], ["Jamie", "-$35", false]].map(([n, a, isIn]) => (
                <div key={n as string} className="flex items-center justify-between py-1.5 text-sm">
                  <span className="text-zinc-300">{n}</span>
                  <span className={`font-mono font-semibold ${isIn ? "text-teal-400" : "text-rose-400"}`}>{a}</span>
                </div>
              ))}
              <div className="mt-2 text-[11px] text-zinc-500">Simplified to 3 payments</div>
            </MockCard>
          }
        />

        {/* final CTA */}
        <Reveal className="max-w-4xl mx-auto px-5 py-20">
          <div className="relative rounded-3xl border border-teal-500/20 bg-gradient-to-b from-teal-500/[0.12] to-transparent p-10 md:p-14 text-center overflow-hidden">
            <div className="pointer-events-none absolute -top-20 left-1/2 -translate-x-1/2 w-80 h-80 rounded-full bg-teal-500/20 blur-[90px]" />
            <h2 className="relative text-3xl md:text-5xl font-bold tracking-tight">Stop being the group accountant.</h2>
            <p className="relative mt-4 text-zinc-400 text-lg">Download Spliiit free and settle up in seconds.</p>
            <div className="relative mt-8 flex justify-center"><StoreButtons os={os} /></div>
          </div>
        </Reveal>

        {/* footer */}
        <footer className="border-t border-white/5 px-5 py-10">
          <div className="max-w-6xl mx-auto flex flex-col items-center gap-4 text-center">
            <div className="flex items-center gap-2 font-semibold">
              <img src="/icon-192.png" alt="" className="w-6 h-6 rounded-md" />
              <span>Spl<span className="text-teal-400">iii</span>t</span>
            </div>
            <div className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-zinc-500">
              <a href="/privacy" className="hover:text-zinc-300 transition">Privacy</a>
              <a href="mailto:inquiries@klarityit.ca" className="hover:text-zinc-300 transition">Contact</a>
              <button onClick={onSignIn} className="hover:text-zinc-300 transition">Sign in</button>
            </div>
            <p className="text-xs text-zinc-600">© 2026 Spliiit · Split expenses effortlessly</p>
          </div>
        </footer>
      </main>
    </div>
  );
}

export function LandingGate() {
  const [showSignIn, setShowSignIn] = useState(false);
  let hasPendingInvite = false;
  try { hasPendingInvite = !!localStorage.getItem("spliiit_pending_invite"); } catch { /* ignore */ }
  const isWeb = !isInTWA && !isIosNative && !isStandalonePWA();
  // App, invite-origin signup, or explicit "Sign in" → straight to the real form.
  if (!isWeb || hasPendingInvite || showSignIn) return <AuthPage />;
  return <Landing onSignIn={() => setShowSignIn(true)} />;
}
