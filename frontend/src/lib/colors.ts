// Colorblind-safe ramps. Values are always printed too; color is never the only cue.
import { scaleDiverging, scaleSequential, scaleSequentialLog } from "d3-scale";
import { interpolateCividis, interpolatePuOr, interpolateYlOrRd } from "d3-scale-chromatic";
import type { AnomalyClass } from "./api";

export type Ramp = "ylorrd" | "cividis";

export function countScale(max: number, log: boolean, ramp: Ramp = "ylorrd") {
  // cividis reversed: pale (low) -> dark (high) on a light background
  const interp = ramp === "ylorrd" ? (t: number) => interpolateYlOrRd(0.04 + t * 0.96) : (t: number) => interpolateCividis(1 - t);
  if (log) {
    const s = scaleSequentialLog(interp).domain([1, Math.max(2, max + 1)]);
    return (v: number) => s(Math.max(1, v + 1));
  }
  const s = scaleSequential(interp).domain([0, Math.max(1, max)]);
  return (v: number) => s(v);
}

// Anomaly: log2(ratio to median), centred on 1x. PuOr reversed: orange = above, purple = below.
export function anomalyScale(limit = 2) {
  const s = scaleDiverging((t: number) => interpolatePuOr(1 - t)).domain([-limit, 0, limit]).clamp(true);
  return (ratio: number | null) => (ratio === null || ratio <= 0 ? (ratio === 0 ? s(-limit) : "#F1F3F8") : s(Math.log2(ratio)));
}

export function textOn(bg: string): string {
  const m = bg.match(/\d+(\.\d+)?/g);
  if (!m || m.length < 3) return "#0B1222";
  const [r, g, b] = m.slice(0, 3).map((v) => Number(v) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.36 ? "#0B1222" : "#FFFFFF";
}

export const CLASS_STYLE: Record<AnomalyClass, { bg: string; fg: string; ring: string; label: string; short: string }> = {
  record_high: { bg: "#7A2E0E", fg: "#FFFFFF", ring: "#7A2E0E", label: "Record high", short: "Record" },
  much_above: { bg: "#B54708", fg: "#FFFFFF", ring: "#B54708", label: "Much above normal", short: "Much above" },
  above: { bg: "#FEDF89", fg: "#7A2E0E", ring: "#F79009", label: "Above normal", short: "Above" },
  normal: { bg: "#EEF1F8", fg: "#1E293B", ring: "#CBD3E3", label: "Normal", short: "Normal" },
  below: { bg: "#E9D7FE", fg: "#42307D", ring: "#9E77ED", label: "Below normal", short: "Below" },
  much_below: { bg: "#6941C6", fg: "#FFFFFF", ring: "#6941C6", label: "Much below normal", short: "Much below" },
  record_low: { bg: "#3E1C96", fg: "#FFFFFF", ring: "#3E1C96", label: "Record low", short: "Record low" },
  no_baseline: { bg: "#F1F3F8", fg: "#475569", ring: "#CBD3E3", label: "No baseline", short: "n/a" },
};

export const SERIES = {
  harmonized: "#D92D20",
  modis: "#4352D6",
  viirs: "#0E9384",
  band: "#FDA29B",
  current: "#D92D20",
  previous: "#64748B",
  envelope: "#E2E7F1",
  iqr: "#FECDCA",
  median: "#1E293B",
};
