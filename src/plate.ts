// Tiny SVG plate/rack renderer for the well maps (RNA rack, cold block, output
// rack, 384 plate). Pure DOM, no deps.
const NS = "http://www.w3.org/2000/svg";

const PALETTE = ["#0d7d7d", "#b25aa0", "#d98324", "#3b7dd8", "#5aa02a", "#c0392b",
  "#1f9e8a", "#d24b8a", "#6a6fd8", "#9c8b1e", "#8e6f3e", "#2a8fb0", "#a0552a", "#5a8e2a"];
export const wellColor = (i: number) => PALETTE[i % PALETTE.length];

export interface WellFill { color: string; label?: string; title?: string; }

function svgEl(tag: string, attrs: Record<string, string | number>, text?: string): SVGElement {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text != null) e.textContent = text;
  return e;
}

export function plateSvg(rows: string[], nCols: number, fills: Map<string, WellFill>,
                         blocked?: Set<string>): SVGElement {
  const nRows = rows.length;
  const cell = nCols >= 20 ? 18 : nCols >= 12 ? 26 : 34;
  const r = cell * 0.42;
  const lx = 18, ty = 16;
  const W = lx + nCols * cell + 6, H = ty + nRows * cell + 6;
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: W, style: "max-width:100%;height:auto" });

  for (let c = 0; c < nCols; c++)
    svg.append(svgEl("text", { x: lx + c * cell + cell / 2, y: ty - 4, "text-anchor": "middle", "font-size": 9, fill: "#6b7280" }, String(c + 1)));
  rows.forEach((rl, ri) =>
    svg.append(svgEl("text", { x: lx - 6, y: ty + ri * cell + cell / 2 + 3, "text-anchor": "end", "font-size": 9, fill: "#6b7280" }, rl)));

  for (let ri = 0; ri < nRows; ri++)
    for (let c = 0; c < nCols; c++) {
      const addr = `${rows[ri]}${c + 1}`;
      const cx = lx + c * cell + cell / 2, cy = ty + ri * cell + cell / 2;
      const fill = fills.get(addr);
      const isBlk = blocked?.has(addr) && !fill;
      const circ = svgEl("circle", {
        cx, cy, r, fill: fill ? fill.color : isBlk ? "#e9ebef" : "#ffffff",
        stroke: isBlk ? "#d4d7dc" : "#c4c9d0", "stroke-width": 1,
      });
      if (fill?.title) circ.append(svgEl("title", {}, fill.title));
      else if (isBlk) circ.append(svgEl("title", {}, `${addr} — blocked`));
      svg.append(circ);
      if (fill?.label && r >= 9)
        svg.append(svgEl("text", { x: cx, y: cy + 3, "text-anchor": "middle", "font-size": Math.min(10, r * 0.9), fill: "#fff", "font-weight": 600 }, fill.label));
    }
  return svg;
}

// Cold block (96): the thermocycler blocks rows A/H and columns 1/12 -> usable B2:G11.
export function coldBlockBlocked(): Set<string> {
  const s = new Set<string>();
  for (const r of "ABCDEFGH") for (let c = 1; c <= 12; c++)
    if (r === "A" || r === "H" || c === 1 || c === 12) s.add(`${r}${c}`);
  return s;
}
