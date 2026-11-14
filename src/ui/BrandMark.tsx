/**
 * The aprinote mark: a flat two-tone apricot — one warm body, one shaded cheek,
 * a single leaf. Drawn rather than iconified because it carries brand colour,
 * not `currentColor`, so it reads the same on light chrome, dark chrome and as
 * the favicon. Legible down to 14px, which is the size the title bar uses.
 */
export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      style={{ flex: 'none', display: 'block' }}
    >
      <circle cx="16" cy="19.4" r="9.8" fill="#e8934e" />
      <path d="M16 9.6a9.8 9.8 0 0 1 0 19.6C20.5 24.5 20.5 14.3 16 9.6Z" fill="#cf7433" />
      <path
        d="M16 9.9c-2.5 2.7-2.5 16.3 0 19"
        stroke="#cf7433"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
      <path d="M16.4 5.6c1.1-1.3 3-2 5.3-2-.2 2.5-1.6 4.2-3.6 4.8" fill="#6f9455" />
      <path d="M16 10V6.6" stroke="#7a5230" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}
