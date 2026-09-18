/**
 * Web landing — app-first marketing page for COLD logged-out web visitors.
 *
 * Warm cream editorial aesthetic (the app's real light theme). Shown ONLY to
 * cold web visitors — NOT the native app (TWA/iOS), installed PWA, invite-origin
 * signups, or anyone who taps "Sign in" (they all fall through to AuthPage,
 * which is untouched).
 *
 * Self-contained: all styles are scoped under `.sl` via an inline <style> block,
 * so the design is pixel-faithful to the approved prototype and can't leak into
 * the rest of the app. Photos live in client/public.
 */

import { useState } from "react";
import { isInTWA } from "@/lib/platform";
import { isIosNative } from "@/lib/iap";
import AuthPage from "@/pages/auth";

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

const styles = `
.sl{
  --canvas:hsl(36 30% 85%); --canvas-2:hsl(36 22% 90%); --paper:hsl(38 20% 97%);
  --ink:hsl(30 6% 13%); --ink-2:hsl(30 5% 29%); --ink-3:hsl(30 4% 44%);
  --rule:hsl(36 14% 76%); --rule-2:hsl(36 13% 86%);
  --terra:hsl(18 46% 48%); --terra-ink:hsl(13 50% 38%);
  --sage:hsl(145 24% 40%); --amber:hsl(36 50% 46%);
  --serif:'Instrument Serif','Times New Roman',Georgia,serif;
  --sans:'Inter Tight',system-ui,-apple-system,'Segoe UI',sans-serif;
  --mono:'JetBrains Mono',ui-monospace,Menlo,monospace;
  --gutter:clamp(18px,4.5vw,76px); --maxw:1280px; --r-card:22px; --r-pill:999px;
  --shadow-photo:0 1px 2px hsl(28 24% 16% / .05), 0 10px 22px -8px hsl(28 24% 16% / .16), 0 30px 60px -20px hsl(28 28% 14% / .22);
  background:var(--canvas); color:var(--ink); font-family:var(--sans);
  font-weight:450; font-size:16px; line-height:1.55; -webkit-font-smoothing:antialiased;
  min-height:100vh; overflow-x:hidden;
}
.sl *{ box-sizing:border-box; }
.sl .wrap{ max-width:var(--maxw); margin-inline:auto; padding-inline:var(--gutter); }
.sl .eyebrow{ font-family:var(--mono); font-size:12px; font-weight:500; letter-spacing:.16em; text-transform:uppercase; color:var(--ink-3); }
.sl h1,.sl h2,.sl h3{ font-family:var(--serif); font-weight:400; margin:0; line-height:1.02; text-wrap:balance; letter-spacing:-.01em; color:var(--ink); }
.sl h1{ font-size:clamp(3.1rem,9vw,6.4rem); }
.sl h2{ font-size:clamp(2.2rem,5.4vw,3.9rem); line-height:1.05; }
.sl h3{ font-size:clamp(1.7rem,3.4vw,2.5rem); }
.sl .em{ font-style:italic; color:var(--terra); }
.sl p{ margin:0; }
.sl .lede{ font-size:clamp(1.05rem,1.6vw,1.28rem); color:var(--ink-2); line-height:1.55; max-width:40ch; }
.sl a{ color:inherit; text-decoration:none; }
.sl .mono{ font-family:var(--mono); font-variant-numeric:tabular-nums; }

.sl .btn{ display:inline-flex; align-items:center; gap:.5em; font-family:var(--sans); font-weight:500; font-size:.98rem; padding:.72em 1.35em; border-radius:var(--r-pill); border:1px solid transparent; cursor:pointer; transition:background .18s ease,color .18s ease,border-color .18s ease; }
.sl .btn-primary{ background:var(--ink); color:var(--canvas); }
.sl .btn-primary:hover{ background:hsl(30 6% 22%); }
.sl :focus-visible{ outline:2px solid var(--terra); outline-offset:3px; border-radius:4px; }

.sl .nav{ position:sticky; top:env(safe-area-inset-top,0px); z-index:50; background:hsl(36 30% 86% / .82); -webkit-backdrop-filter:saturate(1.1) blur(10px); backdrop-filter:saturate(1.1) blur(10px); border-bottom:1px solid var(--rule-2); }
.sl .nav-in{ display:flex; align-items:center; justify-content:space-between; height:70px; }
.sl .brand{ display:flex; align-items:center; gap:.6em; font-family:var(--serif); font-size:1.6rem; letter-spacing:-.01em; }
.sl .brand .glyph{ width:30px; height:30px; }
.sl .nav-links{ display:flex; align-items:center; gap:2.1rem; }
.sl .nav-links a{ font-size:.94rem; color:var(--ink-2); transition:color .15s ease; }
.sl .nav-links a:hover{ color:var(--ink); }
.sl .nav-cta{ display:flex; align-items:center; gap:1.2rem; }
.sl .signin{ background:none; border:0; cursor:pointer; font-family:var(--sans); font-size:.94rem; color:var(--ink-2); padding:.4em .2em; }
.sl .signin:hover{ color:var(--ink); }
@media (max-width:820px){ .sl .nav-links{ display:none; } }

.sl .hero{ padding-block:clamp(48px,8vw,104px) clamp(40px,6vw,76px); }
.sl .hero-grid{ display:grid; grid-template-columns:1.15fr .85fr; gap:clamp(28px,4vw,64px); align-items:center; }
.sl .hero h1{ margin-top:1.1rem; }
.sl .hero .lede{ margin-top:1.6rem; }
.sl .hero-actions{ margin-top:2.1rem; display:flex; align-items:center; gap:1.4rem; flex-wrap:wrap; }
.sl .avail{ font-family:var(--mono); font-size:.8rem; letter-spacing:.08em; color:var(--ink-3); text-transform:uppercase; }
@media (max-width:860px){ .sl .hero-grid{ grid-template-columns:1fr; } }

.sl .photo{ position:relative; border-radius:var(--r-card); overflow:hidden; border:1px solid hsl(30 12% 38% / .10); box-shadow:var(--shadow-photo); aspect-ratio:4/5; max-width:100%; }
.sl .photo.wide{ aspect-ratio:5/4; }
.sl .photo-img{ position:absolute; inset:0; width:100%; height:100%; object-fit:cover; display:block; }
.sl .rem-solo{ max-width:600px; margin-inline:auto; text-align:center; }
.sl .rem-solo .contrast{ margin-inline:auto; }
.sl .rem-solo .ui{ margin-inline:auto; text-align:left; }
.sl .rem-shrug{ margin:1.7rem auto 0; max-width:440px; border-radius:var(--r-card); overflow:hidden; border:1px solid hsl(30 12% 38% / .10); box-shadow:var(--shadow-photo); }
.sl .rem-shrug img{ display:block; width:100%; height:auto; }

.sl .trust{ border-block:1px solid var(--rule-2); }
.sl .trust .wrap{ padding-block:clamp(20px,3vw,30px); }
.sl .trust p{ font-size:clamp(1rem,1.7vw,1.25rem); color:var(--ink-2); max-width:60ch; }
.sl .trust .k{ color:var(--ink); }

.sl section{ padding-block:clamp(56px,8vw,120px); }
.sl .sec-head{ max-width:24ch; }
.sl .sec-head .eyebrow{ display:block; margin-bottom:1.1rem; }

.sl .thesis .wrap{ display:grid; grid-template-columns:1fr 1.1fr; gap:clamp(24px,4vw,64px); align-items:start; }
.sl .thesis .statement{ font-family:var(--serif); font-size:clamp(1.9rem,3.9vw,3.1rem); line-height:1.1; letter-spacing:-.01em; text-wrap:balance; color:var(--ink); }
.sl .thesis .support{ color:var(--ink-2); font-size:1.08rem; line-height:1.62; max-width:42ch; margin-top:1.6rem; }
@media (max-width:820px){ .sl .thesis .wrap{ grid-template-columns:1fr; } }

.sl .how-grid{ display:grid; grid-template-columns:1fr 1fr; gap:clamp(28px,5vw,72px); margin-top:clamp(36px,5vw,60px); align-items:start; }
@media (max-width:900px){ .sl .how-grid{ grid-template-columns:1fr; } }
.sl .acc{ list-style:none; margin:0; padding:0; }
.sl .acc-item{ border-top:1px solid var(--rule); }
.sl .acc-item:last-child{ border-bottom:1px solid var(--rule); }
.sl .acc-head{ width:100%; background:none; border:0; cursor:pointer; text-align:left; display:grid; grid-template-columns:auto 1fr auto; align-items:center; gap:1.1rem; padding:1.35rem 0; font-family:inherit; color:var(--ink); }
.sl .acc-num{ font-family:var(--mono); font-size:.82rem; color:var(--ink-3); font-variant-numeric:tabular-nums; }
.sl .acc-title{ font-family:var(--serif); font-size:clamp(1.5rem,2.5vw,2rem); line-height:1.1; letter-spacing:-.01em; transition:color .18s ease; }
.sl .acc-toggle{ width:34px; height:34px; border-radius:var(--r-pill); border:1px solid var(--rule); display:grid; place-items:center; color:var(--ink-2); flex:none; transition:.2s ease; position:relative; }
.sl .acc-toggle::before,.sl .acc-toggle::after{ content:""; position:absolute; background:currentColor; border-radius:2px; }
.sl .acc-toggle::before{ width:13px; height:1.5px; }
.sl .acc-toggle::after{ width:1.5px; height:13px; transition:transform .22s ease,opacity .22s ease; }
.sl .acc-body{ overflow:hidden; max-height:0; transition:max-height .3s ease; }
.sl .acc-body-in{ padding:0 0 1.5rem; color:var(--ink-2); max-width:46ch; font-size:1.05rem; line-height:1.6; }
.sl .acc-item.open .acc-body{ max-height:340px; }
.sl .acc-item.open .acc-title{ color:var(--terra-ink); }
.sl .acc-item.open .acc-toggle{ background:var(--ink); border-color:var(--ink); color:var(--canvas); }
.sl .acc-item.open .acc-toggle::after{ transform:rotate(90deg); opacity:0; }

.sl .how-panel{ position:sticky; top:calc(70px + env(safe-area-inset-top,0px) + 24px); }
@media (max-width:900px){ .sl .how-panel{ position:static; } }
.sl .panel{ display:none; }
.sl .panel.active{ display:block; animation:sl-fade .32s ease; }
@keyframes sl-fade{ from{ opacity:0; transform:translateY(6px); } to{ opacity:1; transform:none; } }

.sl .ui{ background:var(--paper); border:1px solid var(--rule-2); border-radius:var(--r-card); padding:20px; max-width:420px; }
.sl .ui-head{ display:flex; align-items:baseline; justify-content:space-between; gap:1rem; margin-bottom:.35rem; }
.sl .ui-title{ font-family:var(--sans); font-weight:600; font-size:1.02rem; }
.sl .ui-meta{ font-family:var(--mono); font-size:.76rem; color:var(--ink-3); letter-spacing:.04em; }
.sl .rows{ margin-top:.7rem; }
.sl .row{ display:flex; align-items:center; gap:.75rem; padding:.62rem 0; border-top:1px solid var(--rule-2); }
.sl .row:first-child{ border-top:0; }
.sl .av{ width:28px; height:28px; border-radius:var(--r-pill); background:var(--canvas-2); border:1px solid var(--rule-2); display:grid; place-items:center; font-family:var(--mono); font-size:.72rem; color:var(--ink-2); flex:none; }
.sl .row .nm{ font-weight:500; font-size:.95rem; }
.sl .row .sp{ flex:1; }
.sl .dot{ width:7px; height:7px; border-radius:50%; flex:none; }
.sl .dot.sage{ background:var(--sage); }
.sl .dot.amber{ background:var(--amber); }
.sl .amt{ font-family:var(--mono); font-variant-numeric:tabular-nums; font-size:.9rem; }
.sl .amt.owe{ color:var(--terra-ink); }
.sl .amt.paid{ color:var(--ink-3); }
.sl .st{ font-family:var(--mono); font-size:.74rem; letter-spacing:.03em; }
.sl .st.sage{ color:var(--sage); }
.sl .st.amber{ color:var(--amber); }
.sl .row.pending{ border-top-style:dashed; }
.sl .ui-foot{ margin-top:.9rem; padding-top:.85rem; border-top:1px solid var(--rule-2); display:flex; align-items:center; justify-content:space-between; gap:.75rem; }
.sl .simplify{ font-family:var(--mono); font-size:.78rem; color:var(--ink-3); }
.sl .chip{ font-family:var(--mono); font-size:.74rem; padding:.32em .7em; border-radius:var(--r-pill); background:var(--canvas-2); border:1px solid var(--rule-2); color:var(--terra-ink); }

.sl .compose{ display:flex; align-items:center; gap:.6rem; background:var(--canvas-2); border:1px solid var(--rule-2); border-radius:var(--r-pill); padding:.62rem .7rem .62rem 1rem; }
.sl .compose .txt{ font-size:.9rem; color:var(--ink-2); line-height:1.35; flex:1; }
.sl .compose .send{ width:30px; height:30px; border-radius:var(--r-pill); background:var(--terra); flex:none; display:grid; place-items:center; color:hsl(38 20% 97%); }
.sl .parsed{ display:flex; flex-wrap:wrap; gap:.4rem; margin-top:.9rem; }
.sl .tagpill{ font-family:var(--mono); font-size:.74rem; padding:.34em .68em; border-radius:var(--r-pill); background:var(--canvas-2); border:1px solid var(--rule-2); color:var(--ink-2); }
.sl .tagpill.k{ color:var(--terra-ink); }
.sl .parse-out{ margin-top:.9rem; font-family:var(--mono); font-size:.82rem; color:var(--ink-2); display:flex; gap:.5rem; align-items:center; }

.sl .cadence{ font-family:var(--mono); font-size:.78rem; color:var(--ink-3); margin-top:.15rem; }
.sl .segs{ display:flex; gap:5px; margin:.85rem 0 .5rem; }
.sl .seg{ height:6px; flex:1; border-radius:var(--r-pill); background:var(--rule-2); }
.sl .seg.on{ background:var(--sage); }
.sl .seg.next{ background:var(--amber); opacity:.5; }
.sl .rem-meta{ font-family:var(--mono); font-size:.76rem; color:var(--ink-3); }

.sl .chat .tabs{ display:flex; gap:.4rem; margin-bottom:.9rem; }
.sl .chat .tab{ font-family:var(--mono); font-size:.74rem; padding:.32em .8em; border-radius:var(--r-pill); color:var(--ink-3); border:1px solid transparent; }
.sl .chat .tab.on{ color:var(--ink); border-color:var(--rule-2); background:var(--canvas-2); }
.sl .bub{ border-radius:16px; padding:.7rem .9rem; font-size:.92rem; line-height:1.45; max-width:92%; }
.sl .bub.user{ background:var(--canvas-2); color:var(--ink); margin-left:auto; border-bottom-right-radius:5px; }
.sl .bub.ai{ background:transparent; border:1px solid var(--rule-2); color:var(--ink-2); margin-top:.6rem; border-bottom-left-radius:5px; }
.sl .bub.ai .k{ color:var(--ink); }
.sl .confirm{ margin-top:.7rem; display:flex; align-items:center; gap:.6rem; font-family:var(--mono); font-size:.78rem; color:var(--sage); }

.sl .split{ display:grid; grid-template-columns:1fr 1fr; gap:clamp(28px,5vw,72px); align-items:center; }
.sl .split.rev .col-media{ order:-1; }
@media (max-width:860px){ .sl .split{ grid-template-columns:1fr; } .sl .split.rev .col-media{ order:0; } }
.sl .contrast{ font-size:1.12rem; color:var(--ink-2); line-height:1.6; margin-top:1.3rem; max-width:40ch; }
.sl .contrast .k{ color:var(--ink); }

.sl .payoff{ border-top:1px solid var(--rule-2); }
.sl .payoff .big{ font-family:var(--serif); font-size:clamp(4rem,15vw,10rem); line-height:.92; letter-spacing:-.02em; color:var(--ink); }
.sl .payoff .sub{ color:var(--ink-2); font-size:1.15rem; margin-top:1rem; max-width:36ch; }
.sl .payoff-grid{ display:grid; grid-template-columns:1.3fr .7fr; gap:clamp(28px,5vw,64px); align-items:end; }
@media (max-width:820px){ .sl .payoff-grid{ grid-template-columns:1fr; } }
.sl .payoff-actions{ margin-top:2rem; display:flex; align-items:center; gap:1.3rem; flex-wrap:wrap; }

.sl footer{ background:var(--canvas-2); border-top:1px solid var(--rule-2); padding-block:clamp(48px,6vw,80px) 0; }
.sl .foot-cols{ display:grid; grid-template-columns:1.4fr 1fr 1fr 1fr; gap:clamp(20px,3vw,40px); }
@media (max-width:760px){ .sl .foot-cols{ grid-template-columns:1fr 1fr; } }
.sl .foot-cols h4{ font-family:var(--mono); font-size:.74rem; text-transform:uppercase; letter-spacing:.14em; color:var(--ink-3); margin:0 0 1rem; font-weight:500; }
.sl .foot-cols a,.sl .foot-cols .signin{ display:block; color:var(--ink-2); font-size:.95rem; padding:.28rem 0; text-align:left; }
.sl .foot-cols a:hover,.sl .foot-cols .signin:hover{ color:var(--ink); }
.sl .foot-blurb{ color:var(--ink-2); font-size:.98rem; max-width:30ch; line-height:1.55; }
.sl .foot-blurb .brand-sm{ font-family:var(--serif); font-size:1.4rem; color:var(--ink); }
.sl .foot-brand{ display:inline-flex; align-items:center; gap:.5em; margin-bottom:.5em; }
.sl .foot-glyph{ width:28px; height:28px; flex:none; }
.sl .wordmark{ font-family:var(--serif); font-weight:400; line-height:1; letter-spacing:-.02em; font-size:clamp(5rem,26vw,20rem); color:var(--ink); text-align:center; padding-block:clamp(28px,5vw,60px) clamp(20px,3vw,40px); -webkit-user-select:none; user-select:none; }
.sl .wordmark .iii{ color:var(--ink); }
.sl .foot-legal{ border-top:1px solid var(--rule-2); padding-block:22px; display:flex; justify-content:space-between; gap:1rem; flex-wrap:wrap; font-family:var(--mono); font-size:.76rem; color:var(--ink-3); letter-spacing:.02em; }

@media (prefers-reduced-motion:reduce){
  .sl *{ animation-duration:.001ms !important; transition-duration:.001ms !important; }
}
`;

const STEPS = [
  { n: "01", title: "Say it", body: "“Dinner at Tacofino, I paid $84, split with Maya, Theo and Priya.” That's the whole interface — no receipt scanning, no line items, no forms." },
  { n: "02", title: "It splits & logs", body: "Spliiit does the math and writes it to a real ledger — who paid, who owes, across every dinner and trip. Not a one-off calculation you lose in a chat." },
  { n: "03", title: "It reminds", body: "It sends automatic reminders on a schedule until each person settles up — so the awkward “hey, you still owe me” text is never yours to send." },
  { n: "04", title: "All square", body: "Everyone pays, the ledger zeroes out, and any remaining IOUs collapse into the fewest possible payments. Done — no spreadsheet, no chasing." },
];

function Landing({ onSignIn }: { onSignIn: () => void }) {
  const os = detectOS();
  const storeUrl = os === "android" ? PLAY_URL : APP_STORE_URL;
  const [open, setOpen] = useState(0);

  const store = (label: string, cls = "btn btn-primary") => (
    <a href={storeUrl} target="_blank" rel="noopener noreferrer" className={cls}>{label}</a>
  );

  return (
    <div className="sl">
      <style>{styles}</style>

      <header className="nav">
        <div className="wrap nav-in">
          <a className="brand" href="#top" aria-label="Spliiit home">
            <svg className="glyph" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <rect width="32" height="32" rx="8" fill="var(--ink)" fillOpacity="0.06" />
              <circle cx="10" cy="8.8" r="1.5" fill="var(--ink)" />
              <path d="M10 13.6V23.8" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
              <circle cx="16" cy="8.8" r="1.5" fill="var(--ink)" />
              <path d="M16 13.6V23.8" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
              <circle cx="22" cy="8.8" r="1.5" fill="var(--ink)" />
              <path d="M22 13.6V23.8" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
            </svg>
            <span>Spliiit</span>
          </a>
          <nav className="nav-links" aria-label="Primary">
            <a href="#how">How it works</a>
            <a href="#reminders">Reminders</a>
            <a href="#ai">AI-native</a>
          </nav>
          <div className="nav-cta">
            <button className="signin" onClick={onSignIn}>Sign in</button>
            {store("Get the app")}
          </div>
        </div>
      </header>

      <main id="top">
        {/* hero */}
        <section className="hero">
          <div className="wrap hero-grid">
            <div>
              <span className="eyebrow">AI-first bill splitting</span>
              <h1>How <span className="em">seamless</span> can splitting a bill be?</h1>
              <p className="lede">One sentence. Spliiit is AI-first — describe the bill in plain words and it does the math, writes a real ledger, and chases the money back on a schedule until everyone's square.</p>
              <div className="hero-actions">
                {store("Get the app")}
                <span className="avail">iOS · Android · Web</span>
              </div>
            </div>
            <div className="col-media">
              <div className="photo">
                <img className="photo-img" src="/landing-hero.jpg?v=2" alt="A group of friends laughing together as they split the bill on a phone" loading="eager" />
              </div>
            </div>
          </div>
        </section>

        {/* trust line */}
        <div className="trust">
          <div className="wrap">
            <p><span className="k">Live on iOS, Android, and the web.</span> Split a bill in one sentence — inside the app, or straight from Claude and ChatGPT.</p>
          </div>
        </div>

        {/* thesis */}
        <section className="thesis">
          <div className="wrap">
            <div><span className="eyebrow">Why Spliiit</span></div>
            <div>
              <p className="statement">Anyone can split a bill. Spliiit is the one that chases the money back — on a schedule — until everyone's square.</p>
              <p className="support">A raw chatbot splits once and forgets. Spliiit remembers every cent, simplifies a tangle of IOUs into the fewest payments, and keeps asking so you don't have to. You keep the money, <em>and</em> the friendship.</p>
            </div>
          </div>
        </section>

        {/* how it works — accordion */}
        <section id="how">
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow">How it works</span>
              <h2>Four steps. No math, no forms.</h2>
            </div>

            <div className="how-grid">
              <ul className="acc">
                {STEPS.map((s, i) => (
                  <li className={"acc-item" + (open === i ? " open" : "")} key={s.n}>
                    <button className="acc-head" aria-expanded={open === i} onClick={() => setOpen(i)}>
                      <span className="acc-num">{s.n}</span>
                      <span className="acc-title">{s.title}</span>
                      <span className="acc-toggle" aria-hidden="true" />
                    </button>
                    <div className="acc-body"><div className="acc-body-in">{s.body}</div></div>
                  </li>
                ))}
              </ul>

              <div className="how-panel">
                {/* panel 1: compose / parse */}
                <div className={"panel" + (open === 0 ? " active" : "")}>
                  <div className="ui">
                    <div className="compose">
                      <span className="txt">Dinner at Tacofino, I paid $84, split with Maya, Theo and Priya</span>
                      <span className="send" aria-hidden="true">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                      </span>
                    </div>
                    <div className="parsed">
                      <span className="tagpill k">$84.00</span>
                      <span className="tagpill">You paid</span>
                      <span className="tagpill">Maya</span>
                      <span className="tagpill">Theo</span>
                      <span className="tagpill">Priya</span>
                      <span className="tagpill">even split</span>
                    </div>
                    <div className="parse-out">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12l7 7 7-7" /></svg>
                      3 people owe you <span style={{ color: "var(--terra-ink)" }}>$21.00</span> each
                    </div>
                  </div>
                </div>

                {/* panel 2: ledger */}
                <div className={"panel" + (open === 1 ? " active" : "")}>
                  <div className="ui">
                    <div className="ui-head"><span className="ui-title">Tacofino dinner</span><span className="ui-meta">SAT · $84.00</span></div>
                    <div className="rows">
                      <div className="row"><span className="av">Y</span><span className="nm">You</span><span className="sp" /><span className="dot sage" /><span className="amt paid">paid $84.00</span></div>
                      <div className="row pending"><span className="av">M</span><span className="nm">Maya</span><span className="sp" /><span className="dot amber" /><span className="amt owe">owes $21.00</span></div>
                      <div className="row pending"><span className="av">T</span><span className="nm">Theo</span><span className="sp" /><span className="dot amber" /><span className="amt owe">owes $21.00</span></div>
                      <div className="row pending"><span className="av">P</span><span className="nm">Priya</span><span className="sp" /><span className="dot amber" /><span className="amt owe">owes $21.00</span></div>
                    </div>
                    <div className="ui-foot"><span className="simplify">Simplified across your ledger</span><span className="chip">3 debts → 1 payment</span></div>
                  </div>
                </div>

                {/* panel 3: reminder */}
                <div className={"panel" + (open === 2 ? " active" : "")}>
                  <div className="ui">
                    <div className="ui-head"><span className="ui-title">Auto-reminder</span><span className="ui-meta">Tacofino dinner</span></div>
                    <div className="cadence">Every 3 days until settled</div>
                    <div className="segs" aria-hidden="true"><span className="seg on" /><span className="seg next" /><span className="seg" /><span className="seg" /></div>
                    <div className="rem-meta">Reminder 1 of 4 sent · next in 3 days</div>
                    <div className="rows" style={{ marginTop: "1rem" }}>
                      <div className="row"><span className="av">M</span><span className="nm">Maya</span><span className="sp" /><span className="dot amber" /><span className="st amber">reminded 2d ago</span></div>
                      <div className="row"><span className="av">T</span><span className="nm">Theo</span><span className="sp" /><span className="dot sage" /><span className="st sage">settled</span></div>
                      <div className="row"><span className="av">P</span><span className="nm">Priya</span><span className="sp" /><span className="dot amber" /><span className="st amber">reminded 2d ago</span></div>
                    </div>
                  </div>
                </div>

                {/* panel 4: settled */}
                <div className={"panel" + (open === 3 ? " active" : "")}>
                  <div className="ui">
                    <div className="ui-head"><span className="ui-title">Tacofino dinner</span><span className="ui-meta">SETTLED</span></div>
                    <div className="row" style={{ border: 0, paddingTop: ".2rem" }}>
                      <span className="dot sage" style={{ width: "9px", height: "9px" }} />
                      <span className="nm" style={{ fontWeight: 600 }}>Everyone paid</span>
                      <span className="sp" />
                      <span className="amt" style={{ color: "var(--sage)" }}>$0.00 out</span>
                    </div>
                    <div className="rows" style={{ marginTop: ".5rem" }}>
                      <div className="row"><span className="av">Y</span><span className="nm">You</span><span className="sp" /><span className="dot sage" /><span className="st sage">square</span></div>
                      <div className="row"><span className="av">M</span><span className="nm">Maya</span><span className="sp" /><span className="dot sage" /><span className="st sage">paid $21.00</span></div>
                      <div className="row"><span className="av">T</span><span className="nm">Theo</span><span className="sp" /><span className="dot sage" /><span className="st sage">paid $21.00</span></div>
                      <div className="row"><span className="av">P</span><span className="nm">Priya</span><span className="sp" /><span className="dot sage" /><span className="st sage">paid $21.00</span></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* reminders — the wedge */}
        <section id="reminders">
          <div className="wrap rem-solo">
              <span className="eyebrow">The wedge</span>
              <h2 style={{ marginTop: "1rem" }}>It does the asking.</h2>
              <div className="rem-shrug">
                <img src="/landing-reminders.jpg?v=4" alt="A shrug — so you never have to be the one who asks" loading="lazy" />
              </div>
              <p className="contrast">A chatbot splits once and forgets. <span className="k">Spliiit keeps asking</span> — on a cadence you set — so you keep the money, and the friendship.</p>
              <div className="ui" style={{ marginTop: "2rem" }}>
                <div className="ui-head"><span className="ui-title">Auto-reminder</span><span className="ui-meta">on · every 3 days</span></div>
                <div className="segs" aria-hidden="true"><span className="seg on" /><span className="seg on" /><span className="seg next" /><span className="seg" /></div>
                <div className="rem-meta">2 of 4 sent · 1 settled · next Thursday</div>
                <div className="rows" style={{ marginTop: "1rem" }}>
                  <div className="row"><span className="av">M</span><span className="nm">Maya</span><span className="sp" /><span className="dot sage" /><span className="st sage">paid just now</span></div>
                  <div className="row"><span className="av">P</span><span className="nm">Priya</span><span className="sp" /><span className="dot amber" /><span className="st amber">nudged · 2 left</span></div>
                </div>
              </div>
          </div>
        </section>

        {/* ai-native */}
        <section id="ai">
          <div className="wrap split">
            <div>
              <span className="eyebrow">No app required</span>
              <h2 style={{ marginTop: "1rem" }}>Split a bill without opening the app.</h2>
              <p className="contrast">Spliiit plugs into <span className="k">Claude and ChatGPT</span>. Ask in plain language and it logs the split to your real ledger — reminders and all.</p>
            </div>
            <div className="col-media">
              <div className="ui chat">
                <div className="tabs"><span className="tab on">Claude</span><span className="tab">ChatGPT</span></div>
                <div className="bub user">Split my $84 Tacofino dinner with Maya, Theo and Priya.</div>
                <div className="bub ai">Done — logged to your <span className="k">Spliiit</span> ledger. Maya, Theo and Priya each owe you <span className="k">$21.00</span>. I'll remind them on a schedule until they settle.</div>
                <div className="confirm">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                  Saved to ledger · reminders on
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* payoff */}
        <section className="payoff">
          <div className="wrap payoff-grid">
            <div>
              <span className="eyebrow">The whole point</span>
              <div className="big" style={{ marginTop: "1rem" }}>All square.</div>
              <p className="sub">Everyone paid. Nothing outstanding. No awkward texts.</p>
              <div className="payoff-actions">
                {store("Get the app")}
                <span className="avail">iOS · Android · Web</span>
              </div>
            </div>
            <div className="col-media">
              <div className="ui">
                <div className="ui-head"><span className="ui-title">This month</span><span className="ui-meta">SETTLED</span></div>
                <div className="rows">
                  <div className="row"><span className="av">T</span><span className="nm">Tacofino dinner</span><span className="sp" /><span className="dot sage" /><span className="amt" style={{ color: "var(--sage)" }}>$0.00</span></div>
                  <div className="row"><span className="av">F</span><span className="nm">Fundy trip</span><span className="sp" /><span className="dot sage" /><span className="amt" style={{ color: "var(--sage)" }}>$0.00</span></div>
                  <div className="row"><span className="av">R</span><span className="nm">Rent &amp; utilities</span><span className="sp" /><span className="dot sage" /><span className="amt" style={{ color: "var(--sage)" }}>$0.00</span></div>
                </div>
                <div className="ui-foot"><span className="simplify">Outstanding</span><span className="amt" style={{ color: "var(--sage)", fontSize: "1rem" }}>$0.00</span></div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="wrap">
          <div className="foot-cols">
            <div>
              <p className="foot-blurb">
                <span className="foot-brand">
                  <svg className="foot-glyph" viewBox="0 0 32 32" fill="none" aria-hidden="true">
                    <rect width="32" height="32" rx="8" fill="var(--ink)" fillOpacity="0.06" />
                    <circle cx="10" cy="8.8" r="1.5" fill="var(--ink)" />
                    <path d="M10 13.6V23.8" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
                    <circle cx="16" cy="8.8" r="1.5" fill="var(--ink)" />
                    <path d="M16 13.6V23.8" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
                    <circle cx="22" cy="8.8" r="1.5" fill="var(--ink)" />
                    <path d="M22 13.6V23.8" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  <span className="brand-sm">Spliiit</span>
                </span>
                <br />Split the bill, keep the friendship.</p>
            </div>
            <div>
              <h4>Product</h4>
              <a href="#how">How it works</a>
              <a href="#reminders">Reminders</a>
              <a href="#ai">AI-native</a>
            </div>
            <div>
              <h4>Get it</h4>
              <a href={storeUrl} target="_blank" rel="noopener noreferrer">iOS &amp; Android</a>
              <button className="signin" onClick={onSignIn}>Open in browser</button>
            </div>
            <div>
              <h4>Spliiit</h4>
              <a href="/privacy">Privacy</a>
              <a href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/" target="_blank" rel="noopener noreferrer">Terms</a>
              <a href="mailto:inquiries@klarityit.ca">Contact</a>
              <button className="signin" onClick={onSignIn}>Sign in</button>
            </div>
          </div>

          <div className="wordmark" aria-label="Spliiit">Spl<span className="iii">iii</span>t</div>

          <div className="foot-legal">
            <span>© 2026 Spliiit</span>
            <span>Real ledger · real reminders</span>
          </div>
        </div>
      </footer>
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
