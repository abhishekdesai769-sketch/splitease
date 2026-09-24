/**
 * VoiceCall — talk-back voice mode (OpenAI Realtime over WebRTC).
 *
 * Grok-style: it's a live voice CALL, but it keeps a scrolling chat transcript
 * of both sides (you + Spliiit) the whole time. You can keep talking and log
 * multiple splits without leaving the call.
 *
 * Flow:
 *   1. POST /api/voice/session → ephemeral ek_ token (real key stays server-side)
 *   2. getUserMedia(audio) → mic; RTCPeerConnection; data channel "oai-events"
 *   3. SDP offer → https://api.openai.com/v1/realtime/calls → answer
 *   4. Model listens, TALKS BACK, asks clarifying questions by voice. Both
 *      sides' speech is transcribed and shown as chat bubbles.
 *   5. When it has enough, it calls propose_split → inline Confirm card.
 *   6. On Confirm → POST /api/voice/commit (server resolves names→IDs and
 *      creates the expense through the SAME trusted path the manual form uses),
 *      then a "saved" bubble appears and the call continues.
 *   7. Settling up (propose_settle_up) shows a payment card; Record payment →
 *      POST /api/settle-up. Balance + history questions are answered by voice.
 *
 * The model never writes to the DB — it only proposes; the user taps Confirm.
 */

import { Loader2, Check, Users, Pencil, Paperclip, X, ArrowRight } from "lucide-react";
import { useVoiceCall, money, WEAK_LABEL } from "@/hooks/use-voice-call";

// Same warm avatar palette + hash the rest of the app uses (dashboard/friends).
const WARM_AVATARS = ["#7A3E32", "#8C5A3C", "#9A4A2A", "#A6674A", "#8A6A32", "#B04A34", "#6B4A3A", "#B5794A"];
function warmAvatar(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return WARM_AVATARS[h % WARM_AVATARS.length];
}
function initials(n: string): string {
  return n.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}
function shortDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); }
  catch { return "Today"; }
}

export default function VoiceCall({ onClose }: { onClose: () => void }) {
  const {
    state, error, turns, proposal, setProposal, preview, setPreview, previewing, committing,
    settle, setSettle, settling, commitSettle,
    editing, setEditing, edit, setEdit, ending, speaking, userSpeaking, uploadingReceipt,
    audioRef, bottomRef, meterRef, fileInputRef,
    hangUp, commit, beginEdit, saveEdit, onPickReceipt,
  } = useVoiceCall({ onClose });

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <audio ref={audioRef} autoPlay className="hidden" />

      {/* header */}
      <div className="flex items-center justify-between px-5 pt-[calc(env(safe-area-inset-top)+14px)] pb-3 border-b border-border/60">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-accent-foreground opacity-60 animate-ping" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent-foreground" />
          </span>
          <span className="text-sm font-medium text-foreground">Voice · Spliiit</span>
        </div>
        <button onClick={hangUp} aria-label="End voice" className="h-9 w-9 rounded-full bg-muted border border-border flex items-center justify-center">
          <X className="w-4.5 h-4.5 text-foreground" />
        </button>
      </div>

      {/* chat transcript */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {state === "connecting" && (
          <div className="h-full flex items-center justify-center">
            <p className="text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Connecting…</p>
          </div>
        )}

        {state === "reconnecting" && (
          <div className="h-full flex items-center justify-center">
            <p className="text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Reconnecting…</p>
          </div>
        )}

        {state === "error" && (
          <div className="h-full flex flex-col items-center justify-center gap-4 text-center px-6">
            <p className="text-foreground">{error}</p>
            <button onClick={hangUp} className="h-11 px-6 rounded-full bg-accent-foreground text-white font-medium">Done</button>
          </div>
        )}

        {state === "capped" && (
          <div className="h-full flex flex-col items-center justify-center gap-5 text-center px-8">
            <div className="h-16 w-16 rounded-full bg-accent flex items-center justify-center">
              <span className="flex items-center gap-[3px]" aria-hidden="true">
                {[7, 12, 9].map((h, i) => (
                  <span key={i} style={{ width: 3, height: h, borderRadius: 9999, background: "hsl(var(--accent-foreground))", opacity: 0.5 }} />
                ))}
              </span>
            </div>
            <p className="text-foreground text-[15px] leading-snug max-w-xs">{error}</p>
            <button onClick={hangUp} className="h-12 px-7 rounded-full bg-accent-foreground text-white font-medium">Split by chatting</button>
          </div>
        )}

        {state === "live" && turns.length === 0 && !proposal && !preview && !settle && !previewing && (
          <div className="h-full flex items-center justify-center text-center px-8">
            <p className="text-muted-foreground text-lg">Tell me the bill, a payment, or ask who owes what. 🎙️</p>
          </div>
        )}

        {turns.map((t) => {
          if (!t.text.trim()) return null; // ordered placeholder not yet filled
          if (t.role === "system") {
            return (
              <div key={t.id} className="flex justify-center">
                <span className="rounded-full bg-muted px-3 py-1.5 text-xs text-foreground/80">{t.text}</span>
              </div>
            );
          }
          const mine = t.role === "user";
          return (
            <div key={t.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-[15px] leading-snug ${
                  mine
                    ? "bg-accent-foreground text-white rounded-br-md"
                    : "bg-card border border-border text-foreground rounded-bl-md"
                }`}
              >
                {t.text || "…"}
              </div>
            </div>
          );
        })}

        {/* live "you're speaking" bubble (words fill in when transcription lands) */}
        {userSpeaking && (
          <div className="flex justify-end">
            <div className="rounded-2xl rounded-br-md bg-accent-foreground/90 text-white px-4 py-3 flex items-center gap-1" aria-label="listening">
              <style>{`@keyframes vcDot{0%,60%,100%{opacity:.3}30%{opacity:1}}`}</style>
              {[0, 1, 2].map((i) => (
                <span key={i} style={{ width: 6, height: 6, borderRadius: 9999, background: "currentColor", animation: `vcDot 1.1s ease-in-out ${i * 0.18}s infinite` }} />
              ))}
            </div>
          </div>
        )}

        {/* working out the split */}
        {previewing && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-card border border-border px-4 py-2.5 text-[15px] text-muted-foreground flex items-center gap-2 rounded-bl-md">
              <Loader2 className="w-4 h-4 animate-spin" /> Working out the split…
            </div>
          </div>
        )}

        {/* inline confirm card — server-computed, on-brand */}
        {preview && (
          <div className="flex justify-start">
            <div className="w-[92%] max-w-sm rounded-[24px] border border-border bg-card p-5">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground">Confirm split</p>
                  {!editing && preview.verdict === "high" && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Check className="w-3 h-3" />Looks right</span>
                  )}
                </div>
                {!editing && (
                  <button onClick={beginEdit} aria-label="Edit split" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </button>
                )}
              </div>

              {editing ? (
                <div className="space-y-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-mono text-muted-foreground">$</span>
                    <input
                      type="number" inputMode="decimal" step="0.01" value={edit.amount}
                      onChange={(e) => setEdit((s) => ({ ...s, amount: e.target.value }))}
                      className="w-full bg-muted/60 rounded-xl px-3 py-2 font-mono tabular-nums text-2xl text-foreground outline-none border border-border focus:border-accent-foreground"
                    />
                  </div>
                  <input
                    type="text" placeholder="What was it for?" value={edit.description}
                    onChange={(e) => setEdit((s) => ({ ...s, description: e.target.value }))}
                    className="w-full bg-muted/60 rounded-xl px-3 py-2 text-[15px] text-foreground outline-none border border-border focus:border-accent-foreground"
                  />
                  <input
                    type="date" value={edit.date}
                    onChange={(e) => setEdit((s) => ({ ...s, date: e.target.value }))}
                    className="w-full bg-muted/60 rounded-xl px-3 py-2 text-[15px] text-foreground outline-none border border-border focus:border-accent-foreground"
                  />
                </div>
              ) : (
                <>
                  <div className="flex items-end justify-between gap-3">
                    <span className="font-mono tabular-nums text-foreground leading-none" style={{ fontSize: "2.5rem" }}>{money(preview.amount, preview.currency)}</span>
                    {preview.groupName && (
                      <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-accent px-3 py-1 text-xs text-accent-foreground">
                        <Users className="w-3.5 h-3.5" />{preview.groupName}
                      </span>
                    )}
                  </div>
                  <p className="font-serif text-2xl text-foreground mt-1 capitalize leading-tight">{preview.description}</p>
                  <p className="text-xs text-muted-foreground mt-1">{shortDate(preview.date)} · {preview.paidByYou === false && preview.paidByName ? `${preview.paidByName.split(" ")[0]} paid` : "you paid"} · {preview.splitLabel}</p>
                </>
              )}

              {!editing && preview.verdict === "check" && (
                <div className="mt-3 rounded-xl px-3.5 py-2.5 text-[13px] flex items-center gap-2" style={{ backgroundColor: "rgba(180,120,40,0.14)", color: "#8a5a1a" }}>
                  <Pencil className="w-3.5 h-3.5 shrink-0" />
                  <span>Double-check {WEAK_LABEL[preview.weakField || ""] || "this one"} before saving.</span>
                </div>
              )}

              {!editing && (
              <div className="mt-4 rounded-2xl bg-muted/50 divide-y divide-border/70">
                {preview.people.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 px-3.5 py-2.5">
                    <span className="h-8 w-8 rounded-full text-white text-[11px] font-medium flex items-center justify-center shrink-0" style={{ backgroundColor: warmAvatar(p.id) }}>{initials(p.name)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] text-foreground truncate">{p.name}{p.isYou && <span className="text-muted-foreground text-xs"> you</span>}</p>
                      <p className="text-xs text-muted-foreground">{p.id === (preview.paidById ?? (p.isYou ? p.id : "")) ? `paid ${money(preview.amount, preview.currency)}` : p.isYou ? "your share" : "their share"}</p>
                    </div>
                    <span className="font-mono tabular-nums text-[13.5px] text-foreground shrink-0">{money(p.share, preview.currency)}</span>
                  </div>
                ))}
              </div>
              )}

              {!editing && preview.youGetBack > 0 && (
                <div className="mt-3 rounded-xl bg-accent/60 px-3.5 py-2.5 text-[13.5px] text-foreground">
                  You get back <span className="font-mono tabular-nums font-medium text-accent-foreground">{money(preview.youGetBack, preview.currency)}</span>
                </div>
              )}
              {!editing && (preview.youOwe ?? 0) > 0 && (
                <div className="mt-3 rounded-xl bg-muted px-3.5 py-2.5 text-[13.5px] text-foreground">
                  You owe {preview.paidByName?.split(" ")[0] ?? "them"} <span className="font-mono tabular-nums font-medium">{money(preview.youOwe!, preview.currency)}</span>
                </div>
              )}

              {editing ? (
                <div className="flex gap-3 mt-4">
                  <button
                    onClick={() => setEditing(false)}
                    className="flex-1 h-12 rounded-full border border-border bg-card text-foreground font-medium"
                  >Cancel</button>
                  <button
                    onClick={saveEdit}
                    className="flex-[1.35] h-12 rounded-full bg-accent-foreground text-white font-medium"
                  >Save changes</button>
                </div>
              ) : (
                <div className="flex gap-3 mt-4">
                  <button
                    disabled={committing}
                    onClick={() => { setPreview(null); setProposal(null); }}
                    className="flex-1 h-12 rounded-full border border-border bg-card text-foreground font-medium disabled:opacity-50"
                  >Not quite</button>
                  <button
                    disabled={committing}
                    onClick={() => proposal && commit(proposal)}
                    className="flex-[1.35] h-12 rounded-full bg-accent-foreground text-white font-medium flex items-center justify-center gap-1.5 disabled:opacity-70"
                  >{committing ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Check className="w-[18px] h-[18px]" />Confirm split</>}</button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* settle-up card */}
        {settle && (
          <div className="flex justify-start">
            <div className="w-[92%] max-w-sm rounded-[24px] border border-border bg-card p-5" data-testid="voice-settle-card">
              <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground mb-2">Record payment</p>
              <div className="flex items-end justify-between gap-3">
                <span className="font-mono tabular-nums text-foreground leading-none" style={{ fontSize: "2.5rem" }}>{money(settle.amount, settle.currency)}</span>
                {settle.groupName && (
                  <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-accent px-3 py-1 text-xs text-accent-foreground">
                    <Users className="w-3.5 h-3.5" />{settle.groupName}
                  </span>
                )}
              </div>
              <div className="mt-3 flex items-center gap-2 text-[15px] text-foreground">
                <span className="h-8 w-8 rounded-full text-white text-[11px] font-medium flex items-center justify-center shrink-0" style={{ backgroundColor: warmAvatar(settle.friendIsPayer ? settle.personId : "you") }}>{settle.friendIsPayer ? initials(settle.name) : "YOU"}</span>
                <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="h-8 w-8 rounded-full text-white text-[11px] font-medium flex items-center justify-center shrink-0" style={{ backgroundColor: warmAvatar(settle.friendIsPayer ? "you" : settle.personId) }}>{settle.friendIsPayer ? "YOU" : initials(settle.name)}</span>
                <span className="truncate">{settle.friendIsPayer ? `${settle.name} paid you` : `You paid ${settle.name}`}</span>
              </div>
              <div className="mt-3 rounded-xl bg-accent/60 px-3.5 py-2.5 text-[13.5px] text-foreground">
                {Math.abs(settle.balanceAfter) < 0.01
                  ? "This settles you up."
                  : <>After this, {settle.balanceAfter > 0 ? `${settle.name.split(" ")[0]} owes you` : `you owe ${settle.name.split(" ")[0]}`} <span className="font-mono tabular-nums font-medium">{money(Math.abs(settle.balanceAfter), settle.currency)}</span></>}
              </div>
              <div className="flex gap-3 mt-4">
                <button
                  disabled={settling}
                  onClick={() => setSettle(null)}
                  className="flex-1 h-12 rounded-full border border-border bg-card text-foreground font-medium disabled:opacity-50"
                >Not quite</button>
                <button
                  disabled={settling}
                  onClick={commitSettle}
                  className="flex-[1.35] h-12 rounded-full bg-accent-foreground text-white font-medium flex items-center justify-center gap-1.5 disabled:opacity-70"
                >{settling ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Check className="w-[18px] h-[18px]" />Record payment</>}</button>
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* footer status + end */}
      {state === "live" && (
        <div className="px-5 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-3 border-t border-border/60 flex items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span ref={meterRef} className="flex items-center justify-center gap-[3px] h-6 w-8" aria-hidden="true" style={{ ["--mic" as any]: 0 }}>
              <style>{`@keyframes vcBar{0%{transform:scaleY(.35)}100%{transform:scaleY(1)}}`}</style>
              {[8, 14, 20, 12, 7].map((h, i) => (
                <span key={i} style={{
                  width: 3, height: h, borderRadius: 9999,
                  background: "hsl(var(--accent-foreground))", transformOrigin: "center",
                  // Speaking → the model's animated equalizer. Listening → react
                  // to YOUR mic level so it feels alive while you talk.
                  animation: speaking ? `vcBar ${0.45 + (i % 5) * 0.1}s ease-in-out ${i * 0.05}s infinite alternate` : "none",
                  transform: speaking ? undefined : "scaleY(calc(0.22 + var(--mic, 0) * 1.6))",
                  transition: speaking ? undefined : "transform 90ms linear",
                  opacity: speaking ? 1 : 0.85,
                }} />
              ))}
            </span>
            <span className="text-sm text-muted-foreground truncate">{ending ? "Wrapping up…" : speaking ? "Spliiit is talking…" : "Listening…"}</span>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            className="hidden"
            onChange={onPickReceipt}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingReceipt}
            aria-label="Attach a receipt"
            className="h-11 w-11 rounded-full border border-border bg-card text-foreground flex items-center justify-center shrink-0 disabled:opacity-60"
          >{uploadingReceipt ? <Loader2 className="w-5 h-5 animate-spin" /> : <Paperclip className="w-[18px] h-[18px]" />}</button>
          <button onClick={hangUp} className="h-11 px-6 rounded-full border border-border bg-muted text-foreground font-medium shrink-0">End</button>
        </div>
      )}
    </div>
  );
}
