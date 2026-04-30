/**
 * AuthDoodleBackground
 * --------------------
 * WhatsApp-wallpaper-style doodle pattern for the auth pages. Dense, multi-
 * color "neon" outline icons grouped into four color families:
 *
 *   - Teal   (#14B8A6) — math operators (Spliiit brand color)
 *   - Pink   (#EC4899) — food / dining
 *   - Amber  (#F59E0B) — money / receipts
 *   - Blue   (#3B82F6) — group / people
 *
 * 16 icons per 340x340 tile so the pattern feels alive, not sparse.
 *
 * Opacity:
 *   - Light mode: 28% (vibrant against warm cream, not overwhelming)
 *   - Dark mode:  55% (real neon glow against dark background)
 *
 * Pair this with a halo behind the logo + tagline in auth.tsx so the
 * doodles don't crowd the brand mark.
 */
export function AuthDoodleBackground() {
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none opacity-[0.28] dark:opacity-[0.55]"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <pattern
          id="spliiit-auth-doodle"
          x="0"
          y="0"
          width="340"
          height="340"
          patternUnits="userSpaceOnUse"
        >
          {/* Common stroke settings; each icon group overrides `stroke` color */}
          <g fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">

            {/* ===== ROW 1 ===== */}

            {/* Plus — teal */}
            <g transform="translate(45 50)" stroke="#14B8A6">
              <line x1="-10" y1="0" x2="10" y2="0" />
              <line x1="0" y1="-10" x2="0" y2="10" />
            </g>

            {/* Coin — amber */}
            <g transform="translate(150 30)" stroke="#F59E0B">
              <circle cx="0" cy="0" r="11" />
              <line x1="0" y1="-7" x2="0" y2="7" />
              <path d="M 4 -3 Q 4 -5 0 -5 Q -4 -5 -4 -2 Q -4 1 0 1 Q 4 1 4 4 Q 4 5 0 5 Q -4 5 -4 3" />
            </g>

            {/* Coffee cup — pink */}
            <g transform="translate(245 55)" stroke="#EC4899">
              <path d="M -8 -4 H 7 V 6 Q 7 10 3 10 H -4 Q -8 10 -8 6 Z" />
              <path d="M 7 -1 Q 12 -1 12 3 Q 12 7 7 7" />
              <path d="M -4 -10 Q -2 -8 -4 -6" />
              <path d="M 2 -10 Q 4 -8 2 -6" />
            </g>

            {/* Two people — blue */}
            <g transform="translate(305 110)" stroke="#3B82F6">
              <circle cx="-7" cy="-4" r="3" />
              <path d="M -13 8 Q -7 1 -1 8" />
              <circle cx="7" cy="-4" r="3" />
              <path d="M 1 8 Q 7 1 13 8" />
            </g>

            {/* ===== ROW 2 ===== */}

            {/* Receipt — pink */}
            <g transform="translate(80 130)" stroke="#EC4899">
              <path d="M -8 -12 H 8 V 10 L 5 12 L 2 10 L -2 12 L -5 10 L -8 12 Z" />
              <line x1="-5" y1="-7" x2="5" y2="-7" />
              <line x1="-5" y1="-3" x2="5" y2="-3" />
              <line x1="-5" y1="1" x2="3" y2="1" />
            </g>

            {/* Equals — teal */}
            <g transform="translate(180 145)" stroke="#14B8A6">
              <line x1="-10" y1="-3" x2="10" y2="-3" />
              <line x1="-10" y1="3" x2="10" y2="3" />
            </g>

            {/* Wallet — amber */}
            <g transform="translate(280 165)" stroke="#F59E0B">
              <rect x="-10" y="-7" width="20" height="14" rx="2" />
              <path d="M -10 -2 H 10" />
              <circle cx="6" cy="2" r="1.5" />
            </g>

            {/* Gift box — blue */}
            <g transform="translate(35 215)" stroke="#3B82F6">
              <rect x="-9" y="-3" width="18" height="12" rx="0.5" />
              <line x1="-9" y1="3" x2="9" y2="3" />
              <line x1="0" y1="-3" x2="0" y2="9" />
              <path d="M -3 -3 Q -7 -8 -3 -10 Q 0 -8 0 -3" />
              <path d="M 3 -3 Q 7 -8 3 -10 Q 0 -8 0 -3" />
            </g>

            {/* ===== ROW 3 ===== */}

            {/* Dollar — amber */}
            <g transform="translate(125 200)" stroke="#F59E0B">
              <line x1="0" y1="-13" x2="0" y2="13" />
              <path d="M 6 -8 Q 6 -10 0 -10 Q -6 -10 -6 -6 Q -6 -2 0 0 Q 6 2 6 6 Q 6 10 0 10 Q -6 10 -6 8" />
            </g>

            {/* Fork & knife — pink */}
            <g transform="translate(225 215)" stroke="#EC4899">
              <line x1="-3" y1="-10" x2="-3" y2="10" />
              <line x1="-5" y1="-10" x2="-5" y2="-5" />
              <line x1="-1" y1="-10" x2="-1" y2="-5" />
              <line x1="5" y1="-10" x2="5" y2="10" />
              <path d="M 5 -10 Q 9 -8 9 -3 Q 9 0 5 0" />
            </g>

            {/* Multiply (×) — teal */}
            <g transform="translate(310 250)" stroke="#14B8A6">
              <line x1="-7" y1="-7" x2="7" y2="7" />
              <line x1="-7" y1="7" x2="7" y2="-7" />
            </g>

            {/* ===== ROW 4 ===== */}

            {/* Calculator — amber */}
            <g transform="translate(60 290)" stroke="#F59E0B">
              <rect x="-8" y="-11" width="16" height="22" rx="2" />
              <rect x="-6" y="-9" width="12" height="4" />
              <line x1="-6" y1="-1" x2="6" y2="-1" />
              <line x1="-6" y1="3" x2="6" y2="3" />
              <line x1="-6" y1="7" x2="6" y2="7" />
              <line x1="-2" y1="-3" x2="-2" y2="9" />
              <line x1="2" y1="-3" x2="2" y2="9" />
            </g>

            {/* Two people (repeat, different angle) — blue */}
            <g transform="translate(155 300)" stroke="#3B82F6">
              <circle cx="-7" cy="-4" r="3" />
              <path d="M -13 8 Q -7 1 -1 8" />
              <circle cx="7" cy="-4" r="3" />
              <path d="M 1 8 Q 7 1 13 8" />
            </g>

            {/* Popcorn bag — pink */}
            <g transform="translate(245 295)" stroke="#EC4899">
              <path d="M -6 -3 L -7 11 H 7 L 6 -3 Z" />
              <line x1="-6" y1="0" x2="6" y2="0" />
              <circle cx="-3" cy="-6" r="2" />
              <circle cx="2" cy="-7" r="2" />
              <circle cx="6" cy="-4" r="1.5" />
            </g>

            {/* Plus (repeat) — teal */}
            <g transform="translate(325 320)" stroke="#14B8A6">
              <line x1="-10" y1="0" x2="10" y2="0" />
              <line x1="0" y1="-10" x2="0" y2="10" />
            </g>

            {/* Coffee (repeat, different position) — pink */}
            <g transform="translate(105 330)" stroke="#EC4899">
              <path d="M -8 -4 H 7 V 6 Q 7 10 3 10 H -4 Q -8 10 -8 6 Z" />
              <path d="M 7 -1 Q 12 -1 12 3 Q 12 7 7 7" />
              <path d="M -4 -10 Q -2 -8 -4 -6" />
              <path d="M 2 -10 Q 4 -8 2 -6" />
            </g>

          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#spliiit-auth-doodle)" />
    </svg>
  );
}
