/**
 * Hidden SVG displacement filter for Chromium liquid-glass refraction.
 * Mount once near the app root; referenced via backdrop-filter: url(#yaade-liquid-refract).
 */
export function LiquidGlassFilter() {
  return (
    <svg
      aria-hidden
      width={0}
      height={0}
      style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
      data-yaade-liquid-refract-defs=""
    >
      <filter
        id="yaade-liquid-refract"
        x="-8%"
        y="-8%"
        width="116%"
        height="116%"
        colorInterpolationFilters="sRGB"
      >
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.012 0.012"
          numOctaves="2"
          seed="7"
          result="noise"
        />
        <feGaussianBlur in="noise" stdDeviation="1.4" result="blurred" />
        <feDisplacementMap
          in="SourceGraphic"
          in2="blurred"
          scale="28"
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
    </svg>
  )
}
