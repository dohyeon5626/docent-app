interface IconProps {
  size?: number
}

const base = (size: number): React.SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.3,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
})

export const IconBook = ({ size = 15 }: IconProps): JSX.Element => (
  <svg {...base(size)}>
    <path d="M2.5 3A1.5 1.5 0 0 1 4 1.5h9.5v11H4A1.5 1.5 0 0 0 2.5 14V3Z" />
    <path d="M2.5 12.5A1.5 1.5 0 0 1 4 11h9.5" />
  </svg>
)

export const IconPlus = ({ size = 15 }: IconProps): JSX.Element => (
  <svg {...base(size)}>
    <path d="M8 3v10M3 8h10" />
  </svg>
)

export const IconTrash = ({ size = 14 }: IconProps): JSX.Element => (
  <svg {...base(size)}>
    <path d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.6 9.5h6.8L12 4M6.5 6.5v4.5M9.5 6.5v4.5" />
  </svg>
)

export const IconSplit = ({ size = 17 }: IconProps): JSX.Element => (
  <svg {...base(size)}>
    <rect x="1.5" y="3" width="13" height="10" rx="1.5" />
    <path d="M8 3v10" />
  </svg>
)

export const IconWindows = ({ size = 17 }: IconProps): JSX.Element => (
  <svg {...base(size)}>
    <rect x="1.5" y="2.5" width="9" height="8" rx="1.2" />
    <rect x="5.5" y="5.5" width="9" height="8" rx="1.2" />
  </svg>
)

export const IconChevronLeft = ({ size = 15 }: IconProps): JSX.Element => (
  <svg {...base(size)}>
    <path d="M10 3 5 8l5 5" />
  </svg>
)

export const IconChevronRight = ({ size = 15 }: IconProps): JSX.Element => (
  <svg {...base(size)}>
    <path d="m6 3 5 5-5 5" />
  </svg>
)

export const IconZoomIn = ({ size = 15 }: IconProps): JSX.Element => (
  <svg {...base(size)}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="m13.5 13.5-3.3-3.3M7 5v4M5 7h4" />
  </svg>
)

export const IconZoomOut = ({ size = 15 }: IconProps): JSX.Element => (
  <svg {...base(size)}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="m13.5 13.5-3.3-3.3M5 7h4" />
  </svg>
)

export const IconList = ({ size = 17 }: IconProps): JSX.Element => (
  <svg {...base(size)}>
    <path d="M5.5 4h9M5.5 8h9M5.5 12h9M2 4h.01M2 8h.01M2 12h.01" strokeWidth={1.5} />
  </svg>
)

export const IconSend = ({ size = 15 }: IconProps): JSX.Element => (
  <svg {...base(size)}>
    <path d="M14 2 7.5 8.5M14 2 9.8 14l-2.3-5.5L2 6.2 14 2Z" />
  </svg>
)

export const IconStop = ({ size = 15 }: IconProps): JSX.Element => (
  <svg {...base(size)}>
    <rect x="4" y="4" width="8" height="8" rx="1" />
  </svg>
)

export const IconMore = ({ size = 16 }: IconProps): JSX.Element => (
  <svg {...base(size)}>
    <circle cx="3.2" cy="8" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="8" cy="8" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="12.8" cy="8" r="1.15" fill="currentColor" stroke="none" />
  </svg>
)

export const IconCheck = ({ size = 14 }: IconProps): JSX.Element => (
  <svg {...base(size)}>
    <path d="m2.5 8.5 3.5 3.5 7.5-8" />
  </svg>
)

export const IconChevronDown = ({ size = 13 }: IconProps): JSX.Element => (
  <svg {...base(size)}>
    <path d="m3 6 5 5 5-5" />
  </svg>
)

export const IconDoc = ({ size = 15 }: IconProps): JSX.Element => (
  <svg {...base(size)}>
    <path d="M4 1.5h5.5L13 5v9.5H4V1.5Z" />
    <path d="M9.5 1.5V5H13" />
  </svg>
)
