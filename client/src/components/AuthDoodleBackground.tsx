/**
 * AuthDoodleBackground
 * --------------------
 * WhatsApp-wallpaper-style doodle pattern for the auth pages.
 * MAX DENSITY mode: 32 icons per 240x240 tile, four-color neon palette,
 * tuned to fully cover the background (you should NOT see the page color
 * between doodles).
 *
 * Color families:
 *   Teal   #14B8A6 — math (Spliiit brand)
 *   Pink   #EC4899 — food / hearts
 *   Amber  #F59E0B — money / receipts
 *   Blue   #3B82F6 — group / people
 *
 * Opacity:
 *   Light mode 40%, Dark mode 70%. Pair with the radial halo behind the
 *   logo+tagline in auth.tsx so the brand mark stays clear.
 */
export function AuthDoodleBackground() {
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none opacity-[0.40] dark:opacity-[0.70]"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <pattern
          id="spliiit-auth-doodle"
          x="0"
          y="0"
          width="240"
          height="240"
          patternUnits="userSpaceOnUse"
        >
          <g fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">

            {/* === Row 1 (y ~15-30) === */}
            <g transform="translate(22 25)" stroke="#14B8A6">
              <line x1="-9" y1="0" x2="9" y2="0" /><line x1="0" y1="-9" x2="0" y2="9" />
            </g>
            <g transform="translate(62 18)" stroke="#F59E0B">
              <circle cx="0" cy="0" r="10" /><line x1="0" y1="-6" x2="0" y2="6" />
              <path d="M 4 -3 Q 4 -5 0 -5 Q -4 -5 -4 -2 Q -4 1 0 1 Q 4 1 4 4 Q 4 5 0 5 Q -4 5 -4 3" />
            </g>
            <g transform="translate(105 28)" stroke="#EC4899">
              <path d="M 0 8 C -8 2 -10 -3 -7 -7 C -4 -10 -1 -8 0 -5 C 1 -8 4 -10 7 -7 C 10 -3 8 2 0 8 Z" />
            </g>
            <g transform="translate(150 22)" stroke="#3B82F6">
              <circle cx="-7" cy="-4" r="3" /><path d="M -13 8 Q -7 1 -1 8" />
              <circle cx="7" cy="-4" r="3" /><path d="M 1 8 Q 7 1 13 8" />
            </g>
            <g transform="translate(200 25)" stroke="#14B8A6">
              <line x1="-9" y1="0" x2="9" y2="0" />
              <circle cx="0" cy="-4" r="1.2" /><circle cx="0" cy="4" r="1.2" />
            </g>
            <g transform="translate(220 15)" stroke="#14B8A6">
              <line x1="-7" y1="0" x2="7" y2="0" />
            </g>

            {/* === Row 2 (y ~55-70) === */}
            <g transform="translate(15 65)" stroke="#F59E0B">
              <rect x="-10" y="-7" width="20" height="14" rx="2" />
              <path d="M -10 -2 H 10" /><circle cx="6" cy="2" r="1.5" />
            </g>
            <g transform="translate(50 55)" stroke="#14B8A6">
              <line x1="-9" y1="-3" x2="9" y2="-3" /><line x1="-9" y1="3" x2="9" y2="3" />
            </g>
            <g transform="translate(90 65)" stroke="#EC4899">
              <path d="M -8 -4 H 7 V 6 Q 7 10 3 10 H -4 Q -8 10 -8 6 Z" />
              <path d="M 7 -1 Q 12 -1 12 3 Q 12 7 7 7" />
              <path d="M -4 -10 Q -2 -8 -4 -6" /><path d="M 2 -10 Q 4 -8 2 -6" />
            </g>
            <g transform="translate(130 60)" stroke="#F59E0B">
              <line x1="0" y1="-12" x2="0" y2="12" />
              <path d="M 6 -7 Q 6 -9 0 -9 Q -6 -9 -6 -5 Q -6 -1 0 1 Q 6 3 6 7 Q 6 9 0 9 Q -6 9 -6 7" />
            </g>
            <g transform="translate(170 55)" stroke="#3B82F6">
              <rect x="-9" y="-3" width="18" height="12" rx="0.5" />
              <line x1="-9" y1="3" x2="9" y2="3" /><line x1="0" y1="-3" x2="0" y2="9" />
              <path d="M -3 -3 Q -7 -8 -3 -10 Q 0 -8 0 -3" />
              <path d="M 3 -3 Q 7 -8 3 -10 Q 0 -8 0 -3" />
            </g>
            <g transform="translate(210 65)" stroke="#14B8A6">
              <line x1="-9" y1="0" x2="9" y2="0" /><line x1="0" y1="-9" x2="0" y2="9" />
            </g>

            {/* === Row 3 (y ~95-115) === */}
            <g transform="translate(25 105)" stroke="#EC4899">
              <path d="M -8 -12 H 8 V 10 L 5 12 L 2 10 L -2 12 L -5 10 L -8 12 Z" />
              <line x1="-5" y1="-7" x2="5" y2="-7" /><line x1="-5" y1="-3" x2="5" y2="-3" />
              <line x1="-5" y1="1" x2="3" y2="1" />
            </g>
            <g transform="translate(65 100)" stroke="#F59E0B">
              <rect x="-8" y="-11" width="16" height="22" rx="2" />
              <rect x="-6" y="-9" width="12" height="4" />
              <line x1="-6" y1="-1" x2="6" y2="-1" /><line x1="-6" y1="3" x2="6" y2="3" />
              <line x1="-6" y1="7" x2="6" y2="7" />
              <line x1="-2" y1="-3" x2="-2" y2="9" /><line x1="2" y1="-3" x2="2" y2="9" />
            </g>
            <g transform="translate(110 105)" stroke="#3B82F6">
              <circle cx="-7" cy="-4" r="3" /><path d="M -13 8 Q -7 1 -1 8" />
              <circle cx="7" cy="-4" r="3" /><path d="M 1 8 Q 7 1 13 8" />
            </g>
            <g transform="translate(160 100)" stroke="#EC4899">
              <line x1="-3" y1="-10" x2="-3" y2="10" />
              <line x1="-5" y1="-10" x2="-5" y2="-5" /><line x1="-1" y1="-10" x2="-1" y2="-5" />
              <line x1="5" y1="-10" x2="5" y2="10" />
              <path d="M 5 -10 Q 9 -8 9 -3 Q 9 0 5 0" />
            </g>
            <g transform="translate(195 110)" stroke="#EC4899">
              <path d="M -6 -3 L -7 11 H 7 L 6 -3 Z" /><line x1="-6" y1="0" x2="6" y2="0" />
              <circle cx="-3" cy="-6" r="2" /><circle cx="2" cy="-7" r="2" /><circle cx="6" cy="-4" r="1.5" />
            </g>
            <g transform="translate(225 100)" stroke="#14B8A6">
              <line x1="-6" y1="-6" x2="6" y2="6" /><line x1="-6" y1="6" x2="6" y2="-6" />
            </g>

            {/* === Row 4 (y ~135-155) === */}
            <g transform="translate(20 145)" stroke="#14B8A6">
              <line x1="-9" y1="0" x2="9" y2="0" /><line x1="0" y1="-9" x2="0" y2="9" />
            </g>
            <g transform="translate(55 140)" stroke="#F59E0B">
              <circle cx="0" cy="0" r="10" /><line x1="0" y1="-6" x2="0" y2="6" />
              <path d="M 4 -3 Q 4 -5 0 -5 Q -4 -5 -4 -2 Q -4 1 0 1 Q 4 1 4 4 Q 4 5 0 5 Q -4 5 -4 3" />
            </g>
            <g transform="translate(95 145)" stroke="#EC4899">
              <path d="M 0 8 C -8 2 -10 -3 -7 -7 C -4 -10 -1 -8 0 -5 C 1 -8 4 -10 7 -7 C 10 -3 8 2 0 8 Z" />
            </g>
            <g transform="translate(130 140)" stroke="#F59E0B">
              <rect x="-10" y="-7" width="20" height="14" rx="2" />
              <path d="M -10 -2 H 10" /><circle cx="6" cy="2" r="1.5" />
            </g>
            <g transform="translate(170 150)" stroke="#3B82F6">
              <circle cx="-7" cy="-4" r="3" /><path d="M -13 8 Q -7 1 -1 8" />
              <circle cx="7" cy="-4" r="3" /><path d="M 1 8 Q 7 1 13 8" />
            </g>
            <g transform="translate(215 140)" stroke="#F59E0B">
              <line x1="0" y1="-12" x2="0" y2="12" />
              <path d="M 6 -7 Q 6 -9 0 -9 Q -6 -9 -6 -5 Q -6 -1 0 1 Q 6 3 6 7 Q 6 9 0 9 Q -6 9 -6 7" />
            </g>

            {/* === Row 5 (y ~175-195) === */}
            <g transform="translate(25 180)" stroke="#EC4899">
              <path d="M -8 -4 H 7 V 6 Q 7 10 3 10 H -4 Q -8 10 -8 6 Z" />
              <path d="M 7 -1 Q 12 -1 12 3 Q 12 7 7 7" />
              <path d="M -4 -10 Q -2 -8 -4 -6" /><path d="M 2 -10 Q 4 -8 2 -6" />
            </g>
            <g transform="translate(60 185)" stroke="#3B82F6">
              <rect x="-9" y="-3" width="18" height="12" rx="0.5" />
              <line x1="-9" y1="3" x2="9" y2="3" /><line x1="0" y1="-3" x2="0" y2="9" />
              <path d="M -3 -3 Q -7 -8 -3 -10 Q 0 -8 0 -3" />
              <path d="M 3 -3 Q 7 -8 3 -10 Q 0 -8 0 -3" />
            </g>
            <g transform="translate(100 180)" stroke="#14B8A6">
              <line x1="-9" y1="-3" x2="9" y2="-3" /><line x1="-9" y1="3" x2="9" y2="3" />
            </g>
            <g transform="translate(140 180)" stroke="#F59E0B">
              <rect x="-8" y="-11" width="16" height="22" rx="2" />
              <rect x="-6" y="-9" width="12" height="4" />
              <line x1="-6" y1="-1" x2="6" y2="-1" /><line x1="-6" y1="3" x2="6" y2="3" />
              <line x1="-6" y1="7" x2="6" y2="7" />
              <line x1="-2" y1="-3" x2="-2" y2="9" /><line x1="2" y1="-3" x2="2" y2="9" />
            </g>
            <g transform="translate(180 195)" stroke="#EC4899">
              <path d="M -8 -12 H 8 V 10 L 5 12 L 2 10 L -2 12 L -5 10 L -8 12 Z" />
              <line x1="-5" y1="-7" x2="5" y2="-7" /><line x1="-5" y1="-3" x2="5" y2="-3" />
              <line x1="-5" y1="1" x2="3" y2="1" />
            </g>
            <g transform="translate(220 185)" stroke="#14B8A6">
              <line x1="-9" y1="0" x2="9" y2="0" /><line x1="0" y1="-9" x2="0" y2="9" />
            </g>

            {/* === Row 6 (y ~215-235) === */}
            <g transform="translate(35 220)" stroke="#3B82F6">
              <circle cx="-7" cy="-4" r="3" /><path d="M -13 8 Q -7 1 -1 8" />
              <circle cx="7" cy="-4" r="3" /><path d="M 1 8 Q 7 1 13 8" />
            </g>
            <g transform="translate(90 225)" stroke="#14B8A6">
              <line x1="-9" y1="0" x2="9" y2="0" />
              <circle cx="0" cy="-4" r="1.2" /><circle cx="0" cy="4" r="1.2" />
            </g>
            <g transform="translate(125 220)" stroke="#EC4899">
              <line x1="-3" y1="-10" x2="-3" y2="10" />
              <line x1="-5" y1="-10" x2="-5" y2="-5" /><line x1="-1" y1="-10" x2="-1" y2="-5" />
              <line x1="5" y1="-10" x2="5" y2="10" />
              <path d="M 5 -10 Q 9 -8 9 -3 Q 9 0 5 0" />
            </g>
            <g transform="translate(165 225)" stroke="#F59E0B">
              <circle cx="0" cy="0" r="10" /><line x1="0" y1="-6" x2="0" y2="6" />
              <path d="M 4 -3 Q 4 -5 0 -5 Q -4 -5 -4 -2 Q -4 1 0 1 Q 4 1 4 4 Q 4 5 0 5 Q -4 5 -4 3" />
            </g>
            <g transform="translate(200 220)" stroke="#EC4899">
              <path d="M 0 8 C -8 2 -10 -3 -7 -7 C -4 -10 -1 -8 0 -5 C 1 -8 4 -10 7 -7 C 10 -3 8 2 0 8 Z" />
            </g>
            <g transform="translate(225 232)" stroke="#14B8A6">
              <line x1="-6" y1="-6" x2="6" y2="6" /><line x1="-6" y1="6" x2="6" y2="-6" />
            </g>

          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#spliiit-auth-doodle)" />
    </svg>
  );
}
