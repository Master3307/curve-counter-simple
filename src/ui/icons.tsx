import type { SVGProps } from 'react';

const base = (p: SVGProps<SVGSVGElement>) => ({
  width: 28,
  height: 28,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...p,
});

/** Road-sign style curve arrow. */
export const IconCurveRight = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M7 21v-7a7 7 0 0 1 7-7h4" />
    <path d="M15 3l4 4-4 4" />
  </svg>
);
export const IconCurveLeft = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M17 21v-7a7 7 0 0 0-7-7H6" />
    <path d="M9 3L5 7l4 4" />
  </svg>
);
export const IconRide = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="5.5" cy="16.5" r="3.5" />
    <circle cx="18.5" cy="16.5" r="3.5" />
    <path d="M5.5 16.5l4-7h5l4 7M9.5 9.5L8 6H5.5M14.5 9.5l1.5-3.5h2.5" />
  </svg>
);
export const IconList = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M8 6h13M8 12h13M8 18h13" />
    <circle cx="3.5" cy="6" r="1" />
    <circle cx="3.5" cy="12" r="1" />
    <circle cx="3.5" cy="18" r="1" />
  </svg>
);
export const IconHelp = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9.5" />
    <path d="M9.3 9a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.3-2.7 4" />
    <path d="M12 17.5v.01" />
  </svg>
);
export const IconTrash = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </svg>
);
export const IconCheck = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);
export const IconAlert = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 3l10 18H2L12 3z" />
    <path d="M12 10v5M12 18v.01" />
  </svg>
);

export const IconPin = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </svg>
);

export const IconBattery = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="3" y="7" width="16" height="10" rx="2.5" />
    <path d="M22 10.5v3" />
    <path d="M7 10.5v3M10.5 10.5v3M14 10.5v3" />
  </svg>
);

export const IconSettings = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2.3" />
    <circle cx="10" cy="17" r="2.3" />
  </svg>
);

export const IconShare = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 15V3M7.5 7.5 12 3l4.5 4.5" />
    <path d="M5 12v7.5h14V12" />
  </svg>
);

/**
 * The app logo: a bold amber winding road on a dark tile, mountains behind. Same drawing as
 * assets/src/icon.svg (the launcher icon).
 */
export const AppIcon = ({ className = '' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 512 512" role="img" aria-label="Curve Counter Simple">
    <defs>
      <radialGradient id="ai-bg" cx="30%" cy="20%" r="95%">
        <stop offset="0" stopColor="#2b2f38" />
        <stop offset="1" stopColor="#121418" />
      </radialGradient>
      <clipPath id="ai-clip">
        <rect width="512" height="512" rx="112" />
      </clipPath>
    </defs>
    <g clipPath="url(#ai-clip)">
      <rect width="512" height="512" fill="url(#ai-bg)" />
      <path d="M0 318 L96 214 L150 262 L246 150 L332 252 L396 196 L512 300 V512 H0Z" fill="#2c313b" />
      <path d="M246 150 L222 178 L246 172 L262 190 Z M96 214 L80 232 L98 228 L108 238 Z" fill="#555c69" />
      <path d="M182 540 C182 380 342 392 342 274 C342 168 194 176 194 -30" fill="none" stroke="#0d0f12" strokeWidth="118" strokeLinecap="round" />
      <path d="M182 540 C182 380 342 392 342 274 C342 168 194 176 194 -30" fill="none" stroke="#f2a922" strokeWidth="96" />
      <path d="M182 540 C182 380 342 392 342 274 C342 168 194 176 194 -30" fill="none" stroke="#15171c" strokeWidth="11" strokeDasharray="30 26" />
    </g>
  </svg>
);
