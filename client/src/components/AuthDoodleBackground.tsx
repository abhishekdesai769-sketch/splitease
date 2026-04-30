/**
 * AuthDoodleBackground
 * --------------------
 * A subtle, WhatsApp-style doodle wallpaper for the auth pages (sign-in,
 * sign-up, OTP, forgot password). 8 sparse outline icons (math + money +
 * receipt + people + food) repeating in a 400x400 tile, drawn in the brand
 * teal at "whisper" opacity:
 *
 *   - Light mode: 6% opacity (just barely there)
 *   - Dark mode:  9% opacity (slightly stronger to read against dark bg)
 *
 * All icons inherit `currentColor` from `text-primary`, so a brand color
 * change in tailwind.config.ts propagates here automatically.
 *
 * Drop in once per auth view, as the first child of a `relative
 * overflow-hidden` wrapper. Pointer events disabled so it never intercepts
 * clicks on the form behind it.
 */
export function AuthDoodleBackground() {
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none text-primary opacity-[0.06] dark:opacity-[0.09]"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <pattern
          id="spliiit-auth-doodle"
          x="0"
          y="0"
          width="400"
          height="400"
          patternUnits="userSpaceOnUse"
        >
          <g
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {/* Plus — math */}
            <g transform="translate(60 50)">
              <line x1="-10" y1="0" x2="10" y2="0" />
              <line x1="0" y1="-10" x2="0" y2="10" />
            </g>

            {/* Coffee cup — group expense */}
            <g transform="translate(310 70)">
              <path d="M -8 -4 H 7 V 6 Q 7 10 3 10 H -4 Q -8 10 -8 6 Z" />
              <path d="M 7 -1 Q 12 -1 12 3 Q 12 7 7 7" />
              <path d="M -4 -10 Q -2 -8 -4 -6" />
              <path d="M 2 -10 Q 4 -8 2 -6" />
            </g>

            {/* Receipt — directly Spliiit-relevant */}
            <g transform="translate(140 130)">
              <path d="M -8 -12 H 8 V 10 L 5 12 L 2 10 L -2 12 L -5 10 L -8 12 Z" />
              <line x1="-5" y1="-7" x2="5" y2="-7" />
              <line x1="-5" y1="-3" x2="5" y2="-3" />
              <line x1="-5" y1="1" x2="3" y2="1" />
            </g>

            {/* Equals — math */}
            <g transform="translate(320 180)">
              <line x1="-10" y1="-3" x2="10" y2="-3" />
              <line x1="-10" y1="3" x2="10" y2="3" />
            </g>

            {/* Dollar sign — money */}
            <g transform="translate(50 230)">
              <line x1="0" y1="-13" x2="0" y2="13" />
              <path d="M 6 -8 Q 6 -10 0 -10 Q -6 -10 -6 -6 Q -6 -2 0 0 Q 6 2 6 6 Q 6 10 0 10 Q -6 10 -6 8" />
            </g>

            {/* Two people — group concept */}
            <g transform="translate(210 250)">
              <circle cx="-7" cy="-4" r="3" />
              <path d="M -13 8 Q -7 1 -1 8" />
              <circle cx="7" cy="-4" r="3" />
              <path d="M 1 8 Q 7 1 13 8" />
            </g>

            {/* Calculator — receipts + math */}
            <g transform="translate(350 320)">
              <rect x="-8" y="-11" width="16" height="22" rx="2" />
              <rect x="-6" y="-9" width="12" height="4" />
              <line x1="-6" y1="-1" x2="6" y2="-1" />
              <line x1="-6" y1="3" x2="6" y2="3" />
              <line x1="-6" y1="7" x2="6" y2="7" />
              <line x1="-2" y1="-3" x2="-2" y2="9" />
              <line x1="2" y1="-3" x2="2" y2="9" />
            </g>

            {/* Fork & knife — dining */}
            <g transform="translate(110 350)">
              <line x1="-3" y1="-10" x2="-3" y2="10" />
              <line x1="-5" y1="-10" x2="-5" y2="-5" />
              <line x1="-1" y1="-10" x2="-1" y2="-5" />
              <line x1="5" y1="-10" x2="5" y2="10" />
              <path d="M 5 -10 Q 9 -8 9 -3 Q 9 0 5 0" />
            </g>
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#spliiit-auth-doodle)" />
    </svg>
  );
}
