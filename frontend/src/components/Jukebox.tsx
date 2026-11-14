import { useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceDot, ResponsiveContainer, XAxis, YAxis } from "recharts";
import type { Summary } from "../lib/api";
import { audio, continuousPitch, pitchFor, type NoteSpec, type PlayHandle } from "../lib/audio";
import { SERIES } from "../lib/colors";
import { full, MON, MONTHS, ymLabel } from "../lib/format";
import { Card, Notice, Segmented, useAnnounce } from "./ui";

type Mode = "jump" | "melody" | "decades";
const MODES: { id: Mode; title: string; how: string; text: string }[] = [
  { id: "jump", title: "Hear the sensor jump", how: "Plays the whole monthly record twice: first the raw MODIS-then-VIIRS stitch, then the harmonized series. Pitch follows the log of the count.",
    text: "Without sound: in the raw stitch the line leaps upward when VIIRS takes over, as if fires suddenly doubled. In the harmonized pass the line continues smoothly. The chart below highlights each month as it plays." },
  { id: "melody", title: "Fire season melody", how: "Twelve notes, one per month of the chosen year, on a pentatonic scale. Louder and brighter above the baseline median, softer and darker below.",
    text: "Without sound: each note is one month. Its height is the month's count; dark red markers are months above the median, grey ones below." },
  { id: "decades", title: "Decades sweep", how: "One tone per year across the whole record, about 30 seconds. Rising pitch means more burning; listen for the long trend and the extreme years.",
    text: "Without sound: the chart shows annual totals, with the current year marker moving left to right as it plays." },
];

export function Jukebox({ s }: { s: Summary }) {
  const [mode, setMode] = useState<Mode>("jump");
  const [vol, setVol] = useState(0.35);
  const [speed, setSpeed] = useState(1);
  const [year, setYear] = useState<number>(() => s.annual.filter((a) => a.complete).at(-1)?.year ?? s.years[s.years.length - 1]);
  const [pos, setPos] = useState<number | null>(null);
  const [pass, setPass] = useState<"raw" | "harmonized" | null>(null);
  const [caption, setCaption] = useState("Press play. Sound never starts on its own.");
  const handle = useRef<PlayHandle | null>(null);
  const playing = pos !== null;
  const announce = useAnnounce();

  useEffect(() => { audio.setVolume(vol); }, [vol]);
  useEffect(() => () => audio.stopAll(), []);

  const monthly = useMemo(() => s.monthly.filter((r) => r.harmonized !== null), [s.monthly]);
  const annual = useMemo(() => s.annual.filter((a) => a.total !== null && a.months >= 6), [s.annual]);
  const yearRows = useMemo(() => s.monthly.filter((r) => r.year === year), [s.monthly, year]);

  const chartData = mode === "jump" ? monthly.map((r) => ({ x: r.ym, y: pass === "raw" ? r.stitch : r.harmonized }))
    : mode === "melody" ? yearRows.map((r) => ({ x: MON[r.month - 1], y: r.value, above: (r.ratio ?? 1) > 1 }))
    : annual.map((a) => ({ x: String(a.year), y: a.months === 12 ? a.total : (a.total ?? 0) * (12 / a.months) }));

  function stop() {
    handle.current?.stop();
    handle.current = null;
    setPos(null); setPass(null);
    setCaption("Stopped.");
  }

  async function play() {
    stop();
    audio.setVolume(vol);
    if (mode === "jump") {
      const max = Math.max(1, ...monthly.map((r) => Math.max(r.stitch ?? 0, r.harmonized ?? 0)));
      const step = 0.07 / speed;
      for (const p of ["raw", "harmonized"] as const) {
        setPass(p);
        const msg = p === "raw" ? "Pass 1 of 2: raw stitch. Listen for the leap when VIIRS takes over." : "Pass 2 of 2: harmonized. The leap is gone.";
        setCaption(msg); announce(msg);
        const notes: NoteSpec[] = monthly.map((r) => ({ freq: continuousPitch((p === "raw" ? r.stitch : r.harmonized) ?? 0, max), dur: step * 1.6, gain: 0.45, bright: 0.5, wave: "sine" }));
        const h = audio.sequence(notes, step, (i) => {
          setPos(i);
          if (monthly[i].source === "VIIRS" && monthly[i - 1]?.source === "MODIS") setCaption(`${msg} Now: ${ymLabel(monthly[i].ym)}, switch to VIIRS.`);
        });
        handle.current = h;
        await h.done;
        if (handle.current !== h) return;
        await new Promise((r) => setTimeout(r, 500));
      }
    } else if (mode === "melody") {
      const vals = yearRows.map((r) => r.value ?? 0);
      const max = Math.max(1, ...s.monthly.map((r) => r.value ?? 0));
      const step = 0.42 / speed;
      setCaption(`${year}, January to December.`);
      const notes = yearRows.map((r) => {
        const above = (r.ratio ?? 1) > 1;
        return { freq: pitchFor(r.value ?? 0, max), dur: step * 1.1, gain: above ? 0.85 : 0.35, bright: above ? 0.9 : 0.2 } as NoteSpec;
      });
      const h = audio.sequence(notes, step, (i) => {
        setPos(i);
        const r = yearRows[i];
        setCaption(`${MONTHS[r.month - 1]} ${year}: ${full(vals[i])} ${s.params.unit}${r.ratio ? `, ${r.ratio.toFixed(1)}× median` : ""}.`);
      });
      handle.current = h;
      await h.done;
      if (handle.current !== h) return;
    } else {
      const totals = chartData.map((d) => d.y ?? 0);
      const max = Math.max(1, ...totals);
      const step = Math.min(1.2, 30 / Math.max(1, totals.length)) / speed;
      const notes = totals.map((t) => ({ freq: pitchFor(t, max), dur: step * 0.95, gain: 0.6, bright: 0.3 + 0.7 * (t / max) } as NoteSpec));
      const h = audio.sequence(notes, step, (i) => { setPos(i); setCaption(`${annual[i].year}: ${full(totals[i])} ${s.params.unit}${annual[i].months < 12 ? " (partial year, scaled to 12 months)" : ""}.`); });
      handle.current = h;
      await h.done;
      if (handle.current !== h) return;
    }
    setPos(null); setPass(null);
    setCaption("Finished. Press play to listen again.");
  }

  const m = MODES.find((x) => x.id === mode)!;
  const posPoint = pos !== null ? chartData[pos] : null;

  return (
    <div className="space-y-4">
      {!audio.supported && <Notice level="warn">This browser does not support the Web Audio API. Every mode has a text and visual description below.</Notice>}
      <Card eyebrow="Sonification" title="Fire Jukebox" id="jukebox"
        actions={<span className="eyebrow">higher pitch = more hotspots</span>}>
        <div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="Sound mode">
          {MODES.map((x) => (
            <button key={x.id} role="radio" aria-checked={mode === x.id} onClick={() => { stop(); setMode(x.id); }}
              className={`rounded-xl border p-4 text-left transition ${mode === x.id ? "border-flame-500/50 bg-flame-50/70 shadow-sm" : "border-haze-200 bg-white hover:border-haze-300"}`}>
              <div className="h-display text-[15px]">{x.title}</div>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-3">{x.how}</p>
            </button>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-4 rounded-xl border border-haze-200 bg-haze-50/70 px-4 py-3">
          {playing ? (
            <button className="btn-primary min-w-[96px] justify-center" onClick={stop} aria-label="Stop sound">■ Stop</button>
          ) : (
            <button className="btn-primary min-w-[96px] justify-center" onClick={play} disabled={!audio.supported}>▶ Play</button>
          )}
          {mode === "melody" && (
            <label className="flex items-center gap-2 text-[13px] text-ink-3">Year
              <select className="field w-auto py-1" value={year} onChange={(e) => setYear(Number(e.target.value))}>
                {s.years.slice().reverse().map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
          )}
          <label className="flex items-center gap-2 text-[13px] text-ink-3">Volume
            <input type="range" min={0} max={0.8} step={0.05} value={vol} onChange={(e) => setVol(Number(e.target.value))} aria-valuetext={`${Math.round(vol * 125)}%`} className="accent-flame-600" />
          </label>
          <div className="flex items-center gap-2 text-[13px] text-ink-3">Speed
            <Segmented<string> size="sm" label="Playback speed" value={String(speed)} onChange={(v) => setSpeed(Number(v))}
              options={[{ value: "0.5", label: "0.5×" }, { value: "1", label: "1×" }, { value: "2", label: "2×" }]} />
          </div>
          {pass && <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${pass === "raw" ? "bg-[#E6F4F1] text-[#0E6F63]" : "bg-flame-50 text-flame-700"}`}>{pass === "raw" ? "Raw stitch" : "Harmonized"}</span>}
        </div>

        <p aria-live="polite" className="mt-3 min-h-[22px] text-[14px] font-medium text-ink-2">{caption}</p>

        <div className="mt-2 h-[220px]" role="img" aria-label={m.text}>
          <ResponsiveContainer>
            <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -4 }}>
              <CartesianGrid stroke="#EEF1F8" vertical={false} />
              <XAxis dataKey="x" tick={{ fontSize: 11, fill: "#64748B" }} tickLine={false} minTickGap={30} tickFormatter={(v: string) => (mode === "jump" ? v.slice(0, 4) : v)} />
              <YAxis tick={{ fontSize: 11, fill: "#64748B" }} tickLine={false} axisLine={false} width={54} tickFormatter={(v) => full(v)} scale={mode === "jump" ? "log" : "auto"} domain={mode === "jump" ? [1, "auto"] : [0, "auto"]} allowDataOverflow />
              <Line dataKey="y" stroke={pass === "raw" ? SERIES.viirs : SERIES.harmonized} strokeWidth={mode === "jump" ? 1.4 : 2.2} isAnimationActive={false}
                dot={mode === "melody" ? (p: { cx?: number; cy?: number; payload?: { above?: boolean } }) => <circle key={`${p.cx}`} cx={p.cx} cy={p.cy} r={5} fill={p.payload?.above ? "#B42318" : "#94A3B8"} stroke="#fff" strokeWidth={1.5} /> : false} />
              {posPoint && posPoint.y !== null && <ReferenceDot x={posPoint.x} y={Math.max(1, posPoint.y as number)} r={7} fill="#0B1222" stroke="#fff" strokeWidth={2} />}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-4 rounded-xl border border-haze-200 bg-white px-4 py-3 text-[13px] leading-relaxed text-ink-3">
          <b className="text-ink-2">Text description, for deaf and hard-of-hearing users.</b> {m.text}
        </div>
      </Card>
      <Card eyebrow="How the sound is made" title="Mappings">
        <ul className="grid gap-2 text-[13px] text-ink-3 sm:grid-cols-2">
          <li><b className="text-ink-2">Pitch</b>: log of the count. Melody and sweep modes snap to a pentatonic scale (C3–C6) so they sound musical; the jump demo uses continuous pitch so the leap is exact.</li>
          <li><b className="text-ink-2">Loudness and brightness</b>: louder and brighter above the baseline median, softer and darker below.</li>
          <li><b className="text-ink-2">Crackle</b> (daily view): click rate is proportional to the day's hotspots.</li>
          <li><b className="text-ink-2">Keyboard</b>: turn on "Tones on arrow keys" in the calendar to hear each cell as you move.</li>
        </ul>
        <p className="mt-3 text-[12px] text-ink-4">All sound is synthesized in your browser with the Web Audio API. Nothing autoplays, the default volume is low, and Stop always works.</p>
      </Card>
    </div>
  );
}
