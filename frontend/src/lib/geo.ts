// Place search through Nominatim (OpenStreetMap). One request per explicit search, per its usage policy.
export interface Place { display_name: string; boundingbox: [string, string, string, string] }

export async function geocode(q: string, signal?: AbortSignal): Promise<Place[]> {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`, {
    headers: { "Accept-Language": "en" }, signal,
  });
  if (!r.ok) throw new Error(`Place search failed (${r.status})`);
  return r.json();
}

/** Bounding box [w, s, e, n], padded so a town still gives a ~50 km window. */
export function placeBbox(p: Place): [number, number, number, number] {
  const [s, n, w, e] = p.boundingbox.map(Number);
  const padLat = Math.max(0, (0.45 - (n - s)) / 2), padLon = Math.max(0, (0.45 - (e - w)) / 2);
  return [w - padLon, s - padLat, e + padLon, n + padLat].map((v) => Math.round(v * 1e4) / 1e4) as [number, number, number, number];
}

export const placeName = (p: Place) => p.display_name.split(",").slice(0, 2).join(",");
