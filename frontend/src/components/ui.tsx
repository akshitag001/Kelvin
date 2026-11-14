import { createContext, useCallback, useContext, useId, useRef, useState, type ReactNode } from "react";
import type { AnomalyClass } from "../lib/api";
import { CLASS_STYLE } from "../lib/colors";

export function Segmented<T extends string>({ label, value, options, onChange, size = "md" }: {
  label: string; value: T; options: { value: T; label: string; title?: string }[]; onChange: (v: T) => void; size?: "sm" | "md";
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = options.findIndex((o) => o.value === value);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const n = (idx + (e.key === "ArrowRight" ? 1 : -1) + options.length) % options.length;
    onChange(options[n].value);
    refs.current[n]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKey}
      className="inline-flex rounded-xl border border-haze-200 bg-haze-100/70 p-0.5">
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button key={o.value} ref={(el) => (refs.current[i] = el)} type="button" role="radio" aria-checked={on}
            tabIndex={on ? 0 : -1} title={o.title} onClick={() => onChange(o.value)}
            className={`rounded-[10px] font-medium transition ${size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-[13px]"} ${
              on ? "bg-white text-ink shadow-sm ring-1 ring-haze-200" : "text-ink-3 hover:text-ink"}`}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function ClassPill({ cls, label, size = "md" }: { cls: AnomalyClass | null | undefined; label?: string; size?: "sm" | "md" }) {
  const s = CLASS_STYLE[cls ?? "no_baseline"];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-semibold ${size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"}`}
      style={{ background: s.bg, color: s.fg, boxShadow: `inset 0 0 0 1px ${s.ring}` }}>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: s.fg, opacity: 0.8 }} />
      {label ?? s.label}
    </span>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 text-sm text-ink-3">
      <span className="relative inline-block h-5 w-5">
        <span className="absolute inset-0 rounded-full border-2 border-haze-200" />
        <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-flame-500" />
      </span>
      {label}…
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-xl bg-haze-100 ${className}`} />;
}

export function Card({ title, eyebrow, actions, children, className = "", id }: {
  title?: ReactNode; eyebrow?: string; actions?: ReactNode; children: ReactNode; className?: string; id?: string;
}) {
  return (
    <section className={`card animate-rise ${className}`} aria-labelledby={id}>
      {(title || actions) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
            {title && <h3 id={id} className="h-display text-[17px]">{title}</h3>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-haze-200 bg-white/70 px-4 py-3">
      <div className="eyebrow">{label}</div>
      <div className={`num mt-1 text-xl font-semibold ${accent ? "text-flame-600" : "text-ink"}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-4">{sub}</div>}
    </div>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className="inline-flex cursor-pointer select-none items-center gap-2 text-[13px] text-ink-2" title={hint}>
      <span className="relative inline-flex">
        <input id={id} type="checkbox" role="switch" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-5 w-9 rounded-full bg-haze-300 transition peer-checked:bg-orbit-500 peer-focus-visible:ring-2 peer-focus-visible:ring-orbit-500 peer-focus-visible:ring-offset-2" />
        <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
      </span>
      {label}
    </label>
  );
}

export function Notice({ level, children }: { level: "error" | "warn" | "info"; children: ReactNode }) {
  const style = {
    error: "border-flame-500/40 bg-flame-50 text-flame-800",
    warn: "border-amber-300 bg-amber-50 text-amber-900",
    info: "border-orbit-400/40 bg-[#F0F2FF] text-[#2B3594]",
  }[level];
  return (
    <div role={level === "error" ? "alert" : "note"} className={`flex gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13px] leading-relaxed ${style}`}>
      <span aria-hidden className="mt-0.5 font-mono text-xs font-bold">{level === "error" ? "!" : level === "warn" ? "▲" : "i"}</span>
      <div>{children}</div>
    </div>
  );
}

// --------------------------------------------------------------- live region announcer
const AnnounceCtx = createContext<(msg: string) => void>(() => {});
export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState("");
  const announce = useCallback((m: string) => { setMsg(""); window.setTimeout(() => setMsg(m), 30); }, []);
  return (
    <AnnounceCtx.Provider value={announce}>
      {children}
      <div aria-live="polite" aria-atomic="true" className="sr-only">{msg}</div>
    </AnnounceCtx.Provider>
  );
}
export const useAnnounce = () => useContext(AnnounceCtx);

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const id = useId();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[2000] flex items-start justify-center overflow-y-auto bg-ink/25 p-4 backdrop-blur-sm sm:p-10"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby={id} className="glass w-full max-w-3xl animate-rise p-6 sm:p-8">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id={id} className="h-display text-2xl">{title}</h2>
          <button className="btn-quiet" onClick={onClose} autoFocus aria-label="Close dialog">✕</button>
        </div>
        <div className="prose-kelvin space-y-3 text-[14.5px] leading-relaxed text-ink-2">{children}</div>
      </div>
    </div>
  );
}
