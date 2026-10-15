/** Source-drawn goose in flight: readable neck, head, feathered wings and tail.
 * Uses the condition's currentColor; the card controls severe/reduced-motion behavior.
 */
function Goose() {
  return <g>
    <path d="M44 52 C45 42 52 32 63 24 C67 21 71 20 74 21 C69 27 66 31 63 37 C60 44 56 50 51 55Z" fill="currentColor" opacity=".62" />
    <path d="M22 57 L36 51 C42 48 49 48 55 49 C62 49 66 46 70 42 L75 35 Q78 32 81 34 Q83 35 83 38 L89 41 L81 42 Q78 41 76 44 L69 52 C64 58 57 62 48 62 L40 60 L24 66 L28 60 L19 61Z" fill="currentColor" />
    <path d="M45 56 C39 48 33 34 17 17 Q13 13 10 14 Q12 20 19 27 L12 23 Q14 29 24 34 L17 31 Q20 37 29 41 L23 39 Q27 46 35 49 L31 47 Q35 54 42 57Z" fill="currentColor" />
    <path d="M48 58 Q58 59 64 53" fill="none" stroke="#07131a" strokeOpacity=".4" strokeWidth="1.4" strokeLinecap="round" />
    <circle cx="79" cy="37" r=".9" fill="#07131a" />
  </g>;
}
export default function BirdWatchGlyph() {
  return <svg className="bird-watch-glyph" viewBox="0 0 88 88" aria-hidden="true">
    <circle cx="44" cy="44" r="41" fill="#07131a" stroke="currentColor" strokeOpacity=".36" />
    <circle cx="44" cy="44" r="33" fill="none" stroke="currentColor" strokeOpacity=".1" />
    <path d="M44 4 V9 M84 44 H79 M44 84 V79 M4 44 H9" stroke="currentColor" strokeOpacity=".55" strokeWidth="1.5" />
    <g transform="translate(0 5) scale(.94)"><Goose /></g>
  </svg>;
}
