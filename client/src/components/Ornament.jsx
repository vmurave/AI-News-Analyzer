// Decorative vyshyvanka-style divider: a gold line, a blue line, and a repeating
// row of diamonds (blue + gold). Pure SVG, colored via CSS variables so it
// adapts to light/dark. Purely ornamental → aria-hidden.
export default function Ornament() {
  const blue = { fill: 'var(--ua-stripe-blue)' };
  const gold = { fill: 'var(--ua-stripe-gold)' };
  return (
    <div aria-hidden="true" style={{ lineHeight: 0, backgroundColor: 'var(--bg-surface)' }}>
      <svg
        width="100%"
        height="20"
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ display: 'block' }}
      >
        <defs>
          {/* One tile = a large blue diamond + a small gold diamond, repeated horizontally */}
          <pattern id="ua-ornament" x="0" y="6" width="24" height="14" patternUnits="userSpaceOnUse">
            <rect x="2" y="3" width="8" height="8" transform="rotate(45 6 7)" style={blue} />
            <rect x="16" y="5" width="4" height="4" transform="rotate(45 18 7)" style={gold} />
          </pattern>
        </defs>
        {/* Top stripe line */}
        <rect x="0" y="2" width="100%" height="1" style={blue} />
        {/* Diamond row */}
        <rect x="0" y="6" width="100%" height="14" fill="url(#ua-ornament)" />
      </svg>
    </div>
  );
}
