import { useEffect, useState } from "react";
import { isHeadless, prefersReducedMotion } from "./format";

/** Eased count-up from 0 to `target` (instant when reduced motion is requested). */
export function useCountUp(target: number | null | undefined, ms = 1200): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (target === null || target === undefined) return;
    if (prefersReducedMotion() || isHeadless()) { setV(target); return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      setV(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}
