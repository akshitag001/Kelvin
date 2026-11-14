import { fireEvent, render, screen } from "@testing-library/react";
import type { MonthRow, Summary } from "../lib/api";
import { parse, serialize } from "../lib/state";
import { AoiForm } from "./MapPanel";
import { Calendar, cellLabel } from "./Calendar";
import { AnnouncerProvider } from "./ui";

function row(year: number, month: number, value: number | null, extra: Partial<MonthRow> = {}): MonthRow {
  return {
    ym: `${year}-${String(month).padStart(2, "0")}`, year, month, value, harmonized: value, lo: value, hi: value, modis: value, viirs: null,
    viirs_scaled: null, stitch: value, source: "MODIS", flags: [], median: 100, ratio: value === null ? null : value / 100,
    percentile: 50, z: 0, cls: "normal", ...extra,
  };
}

function summary(): Summary {
  const monthly: MonthRow[] = [];
  for (const y of [2020, 2021]) for (let m = 1; m <= 12; m++) monthly.push(row(y, m, y * 0 + m * 10));
  monthly[0] = row(2020, 1, 10, { flags: ["estimated"] });
  monthly[23] = row(2021, 12, 3120, { ratio: 3.2, cls: "much_above", percentile: 96, flags: ["provisional", "partial"] });
  return {
    aoi: { area_km2: 1, bbox: [0, 0, 1, 1], cells: 1, coverage_fraction: 1, centroid: [0, 0] },
    params: { start: null, end: null, metric: "cells", view: "harmonized", confidence: "nominal", unit: "hotspot cell-days", unit_long: "cell-days" },
    data: { start: "2020-01-01", end: "2021-12-15", demo: true }, baseline: { start_year: 2020, end_year: 2020 },
    monthly, years: [2020, 2021], current: null,
    seasonality: { by_month: [], peak_month: null, season: { months: [], share: 0, start: null, end: null }, current_year: 2021, current: [], previous: [] },
    annual: [], trend: { slope: null, intercept: null, slope_pct: null, p: null, tau: null, n: 0, direction: "none", wording: "" },
    rankings: { months: [], years: [] }, peak: null,
    harmonization: { version: "x", k: 0.8, k_lo: 0.7, k_hi: 0.9, global_k: 0.8, levels: {}, dominant_level: "block", switch_date: "2022-01-01",
      calibration_window: ["2012-02-01", "2021-12-31"], terra_only_until: "2002-08", chain: {}, cv_region: "all", cv: null },
    warnings: [],
  };
}

describe("Calendar", () => {
  it("renders an accessible grid with values in every cell", () => {
    render(<AnnouncerProvider><Calendar s={summary()} onSelect={() => {}} /></AnnouncerProvider>);
    const grid = screen.getByRole("grid");
    expect(grid).toBeInTheDocument();
    const cell = screen.getByRole("gridcell", { name: /December 2021: 3,120 hotspot cell-days, 3.2 times the median, much above normal/ });
    expect(cell).toHaveTextContent("3.1k");
    expect(cell.className).toContain("cell-provisional");
    expect(screen.getByRole("gridcell", { name: /January 2020/ }).className).toContain("cell-estimated");
  });

  it("moves focus with arrow keys and selects with click", () => {
    const onSelect = vi.fn();
    render(<AnnouncerProvider><Calendar s={summary()} onSelect={onSelect} /></AnnouncerProvider>);
    const first = screen.getByRole("gridcell", { name: /^January 2020/ });
    expect(first).toHaveAttribute("tabindex", "0");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(document.activeElement).toHaveAccessibleName(/^February 2020/);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toHaveAccessibleName(/^February 2021/);
    fireEvent.click(document.activeElement!);
    expect(onSelect).toHaveBeenCalledWith("2021-02");
  });

  it("switches to the table view", () => {
    render(<AnnouncerProvider><Calendar s={summary()} onSelect={() => {}} /></AnnouncerProvider>);
    fireEvent.click(screen.getByRole("switch", { name: "Table view" }));
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("builds a descriptive label", () => {
    expect(cellLabel(row(2024, 3, null), "x")).toMatch(/no data/);
  });
});

describe("AoiForm", () => {
  it("validates and submits a bounding box", () => {
    const update = vi.fn();
    const done = vi.fn();
    render(<AoiForm update={update} onDone={done} />);
    fireEvent.click(screen.getByRole("button", { name: "Analyze area" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/all four/);
    const set = (label: RegExp, v: string) => fireEvent.change(screen.getByLabelText(label), { target: { value: v } });
    set(/West/, "76"); set(/South/, "28"); set(/East/, "75"); set(/North/, "30");
    fireEvent.click(screen.getByRole("button", { name: "Analyze area" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/West must be less/);
    set(/East/, "77");
    fireEvent.click(screen.getByRole("button", { name: "Analyze area" }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ aoi: { kind: "bbox", bbox: [76, 28, 77, 30] } }));
    expect(done).toHaveBeenCalled();
  });

  it("validates a point and radius", () => {
    const update = vi.fn();
    render(<AoiForm update={update} onDone={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: "Point + radius" }));
    fireEvent.change(screen.getByLabelText(/Latitude/), { target: { value: "30.2" } });
    fireEvent.change(screen.getByLabelText(/Longitude/), { target: { value: "75" } });
    fireEvent.change(screen.getByLabelText(/Radius/), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze area" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Radius/);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("URL state", () => {
  it("round-trips every AOI kind", () => {
    for (const search of ["?r=punjab_haryana&metric=frp&tab=seasons", "?bbox=75,30,76,31&view=modis&month=2024-11", "?pt=75.5,30.1,50&conf=high&base=2005,2020"]) {
      expect(serialize(parse(search))).toBe(search);
    }
    const g = parse("?geo=" + encodeURIComponent(JSON.stringify([[0, 0], [1, 0], [1, 1], [0, 0]])));
    expect(g.aoi?.kind).toBe("geojson");
    expect(parse("?bbox=garbage").aoi).toBeNull();
  });
});
