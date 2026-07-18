/**
 * App logo: minimal flat mark — three lines of text with one highlighted.
 * No gradients, no glyph fonts; reads as "a summary with the key line marked".
 */
export default function AppLogo({ size = 40 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <rect width="64" height="64" rx="14.5" fill="#2a2e35" />
      <rect x="15" y="19" width="34" height="5.5" rx="2.75" fill="rgba(255,255,255,0.92)" />
      <rect x="15" y="29.25" width="34" height="5.5" rx="2.75" fill="#f7c948" />
      <rect x="15" y="39.5" width="22" height="5.5" rx="2.75" fill="rgba(255,255,255,0.55)" />
    </svg>
  )
}
