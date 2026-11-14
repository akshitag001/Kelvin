export function Logo({ size = 34, withText = true }: { size?: number; withText?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
        <defs>
          <linearGradient id="kHeat" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#FDE68A" />
            <stop offset=".45" stopColor="#F79009" />
            <stop offset="1" stopColor="#B42318" />
          </linearGradient>
          <linearGradient id="kTile" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#FFFFFF" />
            <stop offset="1" stopColor="#EEF1FB" />
          </linearGradient>
        </defs>
        <rect x="1" y="1" width="62" height="62" rx="17" fill="url(#kTile)" stroke="#E2E7F1" />
        <ellipse cx="32" cy="32" rx="27" ry="10" fill="none" stroke="#5B6CF0" strokeWidth="1.6" opacity=".45" transform="rotate(-24 32 32)" />
        <circle cx="55.5" cy="21.5" r="2.6" fill="#5B6CF0" />
        <path d="M22 14v36M22 34l18-20M27 29l14 21" fill="none" stroke="url(#kHeat)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {withText && (
        <span className="leading-none">
          <span className="font-display text-[19px] font-bold tracking-[0.14em] text-ink">KELVIN</span>
          <span className="mt-1 block font-mono text-[9.5px] uppercase tracking-[0.2em] text-ink-4">Fire activity calendar</span>
        </span>
      )}
    </span>
  );
}
