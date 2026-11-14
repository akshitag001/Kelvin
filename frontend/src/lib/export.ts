// Export the first <svg> inside an element to a PNG (2x, white background, attribution footer).
export async function exportPng(el: HTMLElement | null, filename: string, title?: string) {
  const svg = el?.querySelector("svg.recharts-surface, svg[data-export]") as SVGSVGElement | null;
  if (!svg) return;
  const { width, height } = svg.getBoundingClientRect();
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  // inline computed fonts so text renders the same off-DOM
  clone.querySelectorAll("text").forEach((t) => {
    t.setAttribute("font-family", "Inter, Segoe UI, sans-serif");
  });
  const xml = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("render failed")); img.src = url; });
  const scale = 2, head = title ? 36 : 0, foot = 26;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = (height + head + foot) * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, width, height + head + foot);
  if (title) {
    ctx.fillStyle = "#0B1222";
    ctx.font = "600 15px Inter, Segoe UI, sans-serif";
    ctx.fillText(title, 12, 24);
  }
  ctx.drawImage(img, 0, head, width, height);
  ctx.fillStyle = "#64748B";
  ctx.font = "10px Inter, Segoe UI, sans-serif";
  ctx.fillText("KELVIN · Data: NASA FIRMS (LANCE/EOSDIS) MODIS & VIIRS. NASA does not endorse this project.", 12, height + head + 17);
  URL.revokeObjectURL(url);
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = filename;
  a.click();
}
