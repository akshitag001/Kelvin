// A slowly turning orthographic globe drawn on canvas, with the real hotspot activity from /api/globe.
// Drag (or use the arrow keys) to turn it; it pauses under the pointer and stays still for reduced motion.
import { geoDistance, geoGraticule10, geoOrthographic, geoPath } from "d3-geo";
import { useEffect, useRef } from "react";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import landTopo from "world-atlas/land-110m.json";
import type { GlobeData } from "../lib/api";
import { isHeadless, prefersReducedMotion } from "../lib/format";

const topo = landTopo as unknown as Topology<{ land: GeometryCollection }>;
const LAND = feature(topo, topo.objects.land);
const GRATICULE = geoGraticule10();
export const GLOBE_RADIUS = 0.36; // share of the shorter side; the orbit overlay is drawn to match

const SPIN = 0.0025; // degrees per millisecond: one turn in about 2.4 minutes

export function Globe({ data, label }: { data: GlobeData | null; label: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const rot = useRef<[number, number]>([-80, -18]); // starts over India (the loaded regions), then drifts
  const drag = useRef<{ x: number; y: number; r: [number, number] } | null>(null);
  const hover = useRef(false);
  const dataRef = useRef<GlobeData | null>(data);
  dataRef.current = data;

  useEffect(() => {
    const cv = canvas.current!, ctx = cv.getContext("2d")!;
    const reduce = prefersReducedMotion() || isHeadless();
    let raf = 0, last = performance.now(), w = 0, h = 0, dpr = 1;

    const resize = () => {
      const r = wrap.current!.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = r.width; h = r.height;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap.current!);

    const draw = (t: number) => {
      const dt = Math.min(64, t - last);
      last = t;
      if (!reduce && !drag.current && !hover.current) rot.current = [rot.current[0] + dt * SPIN, rot.current[1]];
      const cx = w / 2, cy = h / 2, R = Math.min(w, h) * GLOBE_RADIUS;
      const proj = geoOrthographic().scale(R).translate([cx, cy]).rotate([rot.current[0], rot.current[1], 0]).clipAngle(90);
      const path = geoPath(proj, ctx);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // atmosphere
      const glow = ctx.createRadialGradient(cx, cy, R * 0.92, cx, cy, R * 1.4);
      glow.addColorStop(0, "rgba(124,140,248,0.30)");
      glow.addColorStop(1, "rgba(124,140,248,0)");
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.4, 0, Math.PI * 2); ctx.fill();

      // ocean, lit from the upper left
      const ocean = ctx.createRadialGradient(cx - R * 0.38, cy - R * 0.42, R * 0.08, cx, cy, R);
      ocean.addColorStop(0, "#FFFFFF");
      ocean.addColorStop(0.55, "#E6EBFD");
      ocean.addColorStop(1, "#B9C3F3");
      ctx.fillStyle = ocean;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

      ctx.beginPath(); path(GRATICULE);
      ctx.strokeStyle = "rgba(91,108,240,0.13)"; ctx.lineWidth = 0.7; ctx.stroke();

      ctx.beginPath(); path(LAND);
      ctx.fillStyle = "rgba(255,255,255,0.96)"; ctx.fill();
      ctx.strokeStyle = "rgba(67,82,214,0.38)"; ctx.lineWidth = 0.8; ctx.stroke();

      const d = dataRef.current;
      const center: [number, number] = [-rot.current[0], -rot.current[1]];
      if (d) {
        // loaded regions, dashed
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = "rgba(217,45,32,0.55)"; ctx.lineWidth = 1;
        for (const r of d.regions) {
          const [W, S, E, N] = r.bbox;
          ctx.beginPath();
          // clockwise ring = the small box (d3-geo reads counter-clockwise as "everything but the box")
          path({ type: "Polygon", coordinates: [[[W, S], [W, N], [E, N], [E, S], [W, S]]] });
          ctx.stroke();
        }
        ctx.setLineDash([]);

        // hotspots: older activity amber, the latest month red, the strongest recent ones pulse
        const max = d.max || 1;
        let halos = 0;
        for (const [lon, lat, wgt, recent] of d.points) {
          if (geoDistance([lon, lat], center) > 1.5) continue;
          const p = proj([lon, lat]);
          if (!p) continue;
          const s = Math.sqrt(wgt / max);
          const r = 0.7 + s * 3.4;
          if (recent && halos < 36 && s > 0.25) {
            const k = (Math.sin(t / 420 + lon * 3.1 + lat) + 1) / 2;
            ctx.fillStyle = `rgba(240,68,56,${0.05 + 0.13 * k})`;
            ctx.beginPath(); ctx.arc(p[0], p[1], r * (2.2 + 1.6 * k), 0, Math.PI * 2); ctx.fill();
            halos++;
          }
          ctx.fillStyle = recent ? "rgba(217,45,32,0.9)" : "rgba(247,144,9,0.6)";
          ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.fill();
        }
      }

      // limb shading for depth
      const rim = ctx.createRadialGradient(cx, cy, R * 0.72, cx, cy, R);
      rim.addColorStop(0, "rgba(67,82,214,0)");
      rim.addColorStop(1, "rgba(67,82,214,0.2)");
      ctx.fillStyle = rim;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  const onDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, r: [...rot.current] as [number, number] };
  };
  const onMove = (e: React.PointerEvent) => {
    const g = drag.current;
    if (!g) return;
    rot.current = [g.r[0] + (e.clientX - g.x) * 0.35, Math.max(-60, Math.min(60, g.r[1] - (e.clientY - g.y) * 0.35))];
  };
  const onKey = (e: React.KeyboardEvent) => {
    const step = { ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, -6], ArrowDown: [0, 6] }[e.key as string];
    if (!step) return;
    e.preventDefault();
    rot.current = [rot.current[0] + step[0], Math.max(-60, Math.min(60, rot.current[1] + step[1]))];
  };

  return (
    <div ref={wrap} className="absolute inset-0">
      <canvas ref={canvas} className="h-full w-full cursor-grab touch-none active:cursor-grabbing focus-visible:outline-none"
        role="img" aria-label={label} tabIndex={0}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => (drag.current = null)}
        onPointerEnter={() => (hover.current = true)} onPointerLeave={() => { hover.current = false; drag.current = null; }}
        onKeyDown={onKey} />
    </div>
  );
}
