// KELVIN brand: the official wordmark (orbit swoosh + star) from /brand, with a small product line beside it.
export function Logo({ height = 34, withText = true }: { height?: number; withText?: boolean }) {
  if (!withText) return <img src="/favicon.svg" width={height} height={height} alt="" aria-hidden />;
  return (
    <span className="inline-flex items-center gap-3">
      <img src="/brand/kelvin-logo.png" alt="KELVIN" style={{ height, width: "auto" }} />
      <span aria-hidden className="hidden h-7 w-px bg-haze-300 sm:block" />
      <span className="hidden font-mono text-[9.5px] uppercase leading-tight tracking-[0.2em] text-ink-4 sm:block">
        Fire activity<br />calendar
      </span>
    </span>
  );
}
