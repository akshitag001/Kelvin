// Ctrl/⌘ + K: jump to any region, tab, view or place. Fully keyboard driven (combobox + listbox pattern).
import { useEffect, useMemo, useRef, useState } from "react";
import { geocode, placeBbox, placeName, type Place } from "../lib/geo";

export interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon?: string;
  keywords?: string;
  run: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  commands: Command[];
  onPlace: (bbox: [number, number, number, number], name: string) => void;
}

export function CommandPalette({ open, onClose, commands, onPlace }: Props) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (open) { setQ(""); setPlaces(null); setActive(0); setTimeout(() => input.current?.focus(), 10); }
  }, [open]);

  const items: Command[] = useMemo(() => {
    if (places) {
      return places.length
        ? places.map((p, i) => ({ id: `place-${i}`, group: "Places", label: placeName(p), hint: p.display_name.split(",").slice(2, 4).join(","), icon: "◎",
            run: () => onPlace(placeBbox(p), placeName(p)) }))
        : [{ id: "none", group: "Places", label: `No places found for “${q}”`, icon: "·", run: () => setPlaces(null) }];
    }
    const t = q.trim().toLowerCase();
    const hits = t ? commands.filter((c) => `${c.label} ${c.group} ${c.keywords ?? ""}`.toLowerCase().includes(t)) : commands;
    if (t.length >= 2) {
      hits.push({ id: "geocode", group: "Places", label: `Search places for “${q.trim()}”`, hint: "OpenStreetMap", icon: "⌕", run: () => {} });
    }
    return hits;
  }, [commands, q, places, onPlace]);

  useEffect(() => { setActive(0); }, [q, places]);
  useEffect(() => {
    list.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  async function choose(c: Command) {
    if (c.id === "geocode") {
      setBusy(true);
      try { setPlaces(await geocode(q.trim())); } catch { setPlaces([]); } finally { setBusy(false); }
      return;
    }
    if (c.id === "none") { setPlaces(null); return; }
    c.run();
    onClose();
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); if (places) setPlaces(null); else onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter" && items[active]) { e.preventDefault(); void choose(items[active]); }
  }

  if (!open) return null;
  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-[2500] flex items-start justify-center bg-ink/20 px-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" className="glass w-full max-w-xl animate-rise overflow-hidden p-0" onKeyDown={onKey}>
        <div className="flex items-center gap-3 border-b border-haze-200 px-4 py-3">
          <span aria-hidden className="text-lg text-ink-4">⌕</span>
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setPlaces(null); }}
            role="combobox" aria-expanded="true" aria-controls="cmdk-list" aria-activedescendant={items[active] ? `cmd-${items[active].id}` : undefined}
            aria-label="Type a command, region or place" placeholder="Jump to a region, tab, view, or search a place…"
            className="w-full bg-transparent text-[15px] text-ink placeholder:text-ink-4 focus:outline-none" />
          {busy ? <span className="text-xs text-ink-4">searching…</span> : <kbd>Esc</kbd>}
        </div>
        <ul id="cmdk-list" ref={list} role="listbox" aria-label="Results" className="scrollbar-thin max-h-[52vh] overflow-y-auto p-2">
          {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-ink-4">Nothing matches. Type at least two letters to search places.</li>}
          {items.map((c, i) => {
            const head = c.group !== lastGroup ? (lastGroup = c.group) : null;
            return (
              <li key={c.id} role="presentation">
                {head && <div className="eyebrow px-3 pb-1 pt-3">{head}</div>}
                <div id={`cmd-${c.id}`} role="option" aria-selected={i === active} data-idx={i}
                  onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); void choose(c); }}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] ${i === active ? "bg-ink text-white" : "text-ink-2"}`}>
                  <span aria-hidden className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[13px] ${i === active ? "bg-white/15" : "bg-haze-100 text-ink-3"}`}>{c.icon ?? "→"}</span>
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  {c.hint && <span className={`truncate text-[12px] ${i === active ? "text-white/70" : "text-ink-4"}`}>{c.hint}</span>}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center gap-3 border-t border-haze-200 bg-haze-50/80 px-4 py-2 text-[11px] text-ink-4">
          <span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span>
          <span className="ml-auto">Ctrl / ⌘ + K anywhere</span>
        </div>
      </div>
    </div>
  );
}
