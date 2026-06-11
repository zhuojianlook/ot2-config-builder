// Template parsing, config assembly, and CSV writing — shared by both tabs.
import type { Cfg } from "./cdna";

export type Entry =
  | { kind: "section"; text: string }
  | { kind: "param"; name: string; value: string; desc: string };

// --- CSV helpers ------------------------------------------------------------
function csvField(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
function csvRow(cells: string[]): string {
  return cells.map(csvField).join(",");
}

// Minimal RFC-ish CSV row parser (handles quotes + embedded commas).
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function parseTemplate(text: string): Entry[] {
  const entries: Entry[] = [];
  for (const row of parseCsvRows(text)) {
    if (!row.length || !row[0].trim()) continue;
    const key = row[0].trim();
    if (key.toLowerCase() === "parameter") continue;
    if (key.startsWith("#")) entries.push({ kind: "section", text: key });
    else entries.push({ kind: "param", name: key, value: (row[1] ?? "").trim(), desc: (row[2] ?? "").trim() });
  }
  return entries;
}

export function settingsEntries(entries: Entry[], isSetting: (n: string) => boolean): Entry[] {
  const out: Entry[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.kind === "section") {
      let keep = false;
      for (let j = i + 1; j < entries.length && entries[j].kind !== "section"; j++) {
        const p = entries[j];
        if (p.kind === "param" && isSetting(p.name)) { keep = true; break; }
      }
      if (keep) out.push(e);
    } else if (isSetting(e.name)) out.push(e);
  }
  return out;
}

// --- cDNA ------------------------------------------------------------------
export interface CdnaSample { name: string; conc: string; position: string; }

export const cdnaIsSetting = (n: string) => !n.startsWith("sample_");

export function cdnaSamplesFromEntries(entries: Entry[]): CdnaSample[] {
  const m: Record<number, Record<string, string>> = {};
  for (const e of entries) {
    if (e.kind !== "param" || !e.name.startsWith("sample_")) continue;
    const parts = e.name.split("_");
    const idx = parseInt(parts[1], 10);
    if (isNaN(idx)) continue;
    (m[idx] ??= {})[parts.slice(2).join("_")] = e.value;
  }
  const out: CdnaSample[] = [];
  for (const i of Object.keys(m).map(Number).sort((a, b) => a - b)) {
    const d = m[i];
    if (d.name || d.conc || d.position)
      out.push({ name: d.name || "", conc: d.conc || "", position: (d.position || "").toUpperCase() });
  }
  return out;
}

export function cdnaAssembleCfg(settings: Cfg, samples: CdnaSample[]): Cfg {
  const cfg: Cfg = { ...settings };
  let n = 0;
  for (const s of samples) {
    if (s.conc === "" && !s.name && !s.position) continue;
    n++;
    if (s.name) cfg[`sample_${n}_name`] = s.name;
    cfg[`sample_${n}_conc`] = s.conc;
    cfg[`sample_${n}_position`] = s.position.toUpperCase();
  }
  return cfg;
}

export function cdnaWriteConfig(settingEntries: Entry[], settings: Cfg, samples: CdnaSample[]): string {
  const lines = [csvRow(["Parameter", "Value", "Description"])];
  for (const e of settingEntries) {
    if (e.kind === "section") lines.push(csvRow([e.text, "", ""]));
    else lines.push(csvRow([e.name, String(settings[e.name] ?? e.value), e.desc]));
  }
  lines.push(csvRow(["# === SAMPLES (built by OT-2 Config Builder) ===", "", ""]));
  let n = 0;
  for (const s of samples) {
    if (s.conc === "" && !s.name && !s.position) continue;
    n++;
    lines.push(csvRow([`sample_${n}_name`, s.name, `Sample ${n} label`]));
    lines.push(csvRow([`sample_${n}_conc`, s.conc, "RNA concentration (ng/uL)"]));
    lines.push(csvRow([`sample_${n}_position`, s.position.toUpperCase(), "RNA tube position (A1..D6)"]));
  }
  return lines.join("\n") + "\n";
}

// --- qPCR ------------------------------------------------------------------
const QPCR_WORKFLOW = new Set(["num_samples", "num_genes", "replicates", "use_premixed_primers"]);
export const qpcrIsSetting = (n: string) => !QPCR_WORKFLOW.has(n) && !n.startsWith("gene_") && !n.startsWith("sample_");

export function qpcrNamesFromEntries(entries: Entry[], prefix: string): string[] {
  const m: Record<number, string> = {};
  for (const e of entries) {
    if (e.kind !== "param" || !e.name.startsWith(prefix)) continue;
    const i = parseInt(e.name.split("_").pop()!, 10);
    if (!isNaN(i)) m[i] = e.value;
  }
  return Object.keys(m).map(Number).sort((a, b) => a - b).map((i) => m[i]).filter((v) => v.trim());
}

export function qpcrAssembleCfg(settings: Cfg, genes: string[], samples: string[], reps: number, premixed: boolean): Cfg {
  const cfg: Cfg = { ...settings };
  cfg.num_genes = String(genes.length);
  cfg.num_samples = String(samples.length);
  cfg.replicates = String(reps);
  cfg.use_premixed_primers = premixed ? "true" : "false";
  genes.forEach((g, i) => (cfg[`gene_${i + 1}`] = g));
  samples.forEach((s, i) => (cfg[`sample_${i + 1}`] = s));
  return cfg;
}

export function qpcrWriteConfig(allEntries: Entry[], settings: Cfg, genes: string[], samples: string[], reps: number, premixed: boolean): string {
  const vals: Cfg = { ...settings, num_genes: String(genes.length), num_samples: String(samples.length), replicates: String(reps), use_premixed_primers: premixed ? "true" : "false" };
  const lines = [csvRow(["Parameter", "Value", "Description"])];
  for (const e of allEntries) {
    if (e.kind === "section") {
      if (/GENE|SAMPLE/i.test(e.text)) continue;
      lines.push(csvRow([e.text, "", ""]));
    } else if (!e.name.startsWith("gene_") && !e.name.startsWith("sample_")) {
      lines.push(csvRow([e.name, String(vals[e.name] ?? e.value), e.desc]));
    }
  }
  lines.push(csvRow(["# === GENES (names; up to 12) ===", "", ""]));
  genes.forEach((g, i) => lines.push(csvRow([`gene_${i + 1}`, g, `Gene ${i + 1} name`])));
  lines.push(csvRow(["# === SAMPLES (names; up to 8) ===", "", ""]));
  samples.forEach((s, i) => lines.push(csvRow([`sample_${i + 1}`, s, `Sample ${i + 1} name`])));
  return lines.join("\n") + "\n";
}
