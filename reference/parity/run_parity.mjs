// Parity test: prove the TypeScript planners produce the SAME plan + validation
// decisions as the Python reference planners. Run with `npm run parity`. Exits
// non-zero (failing CI) on any divergence.
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

// ---- build the battery of test cases ---------------------------------------
function cdnaCfg(samples, extra = {}) {
  const cfg = { ...extra };
  samples.forEach((s, i) => {
    const n = i + 1;
    if (s.name !== undefined) cfg[`sample_${n}_name`] = s.name;
    cfg[`sample_${n}_conc`] = String(s.conc);
    cfg[`sample_${n}_position`] = s.pos ?? "";
  });
  return { kind: "cdna", cfg };
}
function qpcrCfg(cfg) { return { kind: "qpcr", cfg }; }

const RNA = (i) => ["A1", "A2", "A3", "A4", "A5", "A6", "B1", "B2", "B3", "B4", "B5", "B6",
  "C1", "C2", "C3", "C4", "C5", "C6", "D1", "D2", "D3", "D4", "D5", "D6"][i];

const cases = [];
// single-sample sweep across concentrations -> every regime + edge
for (const c of [2000, 1600, 1500, 200, 150, 100, 75, 74, 60, 50, 41.67, 41, 39.47, 30, 20, 10.42, 10, 8, 5, 1, 0, -50, 0.5]) {
  cases.push(cdnaCfg([{ name: "S", conc: c, pos: "A1" }]));
}
// multi-sample mixes
cases.push(cdnaCfg([{ conc: 150, pos: "A1" }, { conc: 60, pos: "A2" }, { conc: 30, pos: "A3" }, { conc: 8, pos: "A4" }]));
cases.push(cdnaCfg([{ conc: 150, pos: "A1" }, { conc: 150, pos: "A1" }]));          // dup position
cases.push(cdnaCfg([{ conc: 150, pos: "A7" }]));                                     // illegal position
cases.push(cdnaCfg([{ conc: 150, pos: "" }]));                                       // no position
// 16-sample regime-2 batch (near MM cap) + a 26-sample over-capacity batch
cases.push(cdnaCfg(Array.from({ length: 16 }, (_, i) => ({ conc: 60, pos: RNA(i) }))));
cases.push(cdnaCfg(Array.from({ length: 26 }, (_, i) => ({ conc: 150, pos: RNA(i % 24) }))));
// setting variations
cases.push(cdnaCfg([{ conc: 150, pos: "A1" }], { mastermix_per_rxn: "30", rxn_total_vol: "30" })); // budget 0
cases.push(cdnaCfg([{ conc: 150, pos: "A1" }], { water_tube_fill_uL: "100", water_residual_uL: "50" })); // water chunk
cases.push(cdnaCfg([{ conc: 150, pos: "A1" }], { mm_tube_well: "C1" }));             // mm collide
cases.push(cdnaCfg([{ conc: 150, pos: "A1" }], { slot_output_rack: "3" }));          // overhang
cases.push(cdnaCfg([{ conc: 150, pos: "A1" }], { elution_volume: "36", rna_dead_volume: "2", low_conc_action: "convert" }));
cases.push(cdnaCfg([{ conc: 8, pos: "A1" }], { low_conc_action: "convert" }));       // below floor but convert
cases.push(cdnaCfg([{ conc: 150, pos: "A1" }], { final_cdna_conc: "5", target_ng: "1200" }));

// qPCR cases
for (const [ns, ng, reps] of [[2, 3, 3], [1, 1, 1], [8, 12, 3], [8, 12, 4], [9, 3, 3], [2, 13, 2], [0, 3, 3], [3, 0, 2], [4, 5, 2], [8, 12, 1]]) {
  const cfg = { num_samples: String(ns), num_genes: String(ng), replicates: String(reps) };
  for (let i = 1; i <= 12; i++) cfg[`gene_${i}`] = `G${i}`;
  for (let i = 1; i <= 8; i++) cfg[`sample_${i}`] = `Smp${i}`;
  cases.push(qpcrCfg(cfg));
}

// ---- run TS side -----------------------------------------------------------
const outdir = mkdtempSync(join(tmpdir(), "parity-"));
const bundle = join(outdir, "ts_entry.mjs");
await build({
  entryPoints: [join(HERE, "ts_entry.ts")],
  bundle: true, format: "esm", platform: "node", outfile: bundle, logLevel: "silent",
});
const { dumpAll } = await import(pathToFileURL(bundle).href);
const tsRes = dumpAll(cases);

// ---- run Python side -------------------------------------------------------
const casesFile = join(outdir, "cases.json");
writeFileSync(casesFile, JSON.stringify(cases));
const py = spawnSync("python3", [join(HERE, "py_dump.py"), casesFile], { encoding: "utf8" });
if (py.status !== 0) { console.error("python dump failed:\n", py.stderr); process.exit(2); }
const pyRes = JSON.parse(py.stdout);

// ---- compare ---------------------------------------------------------------
const NUM = new Set(["regime", "n_rxns", "ng_converted", "pooled_vol", "hard_floor",
  "dilution_water", "final_vol", "final_conc"]);
const mism = [];
function close(a, b) { return typeof a === "number" && typeof b === "number" ? Math.abs(a - b) <= 1e-6 : a === b; }
function cmp(path, a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) { mism.push(`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); return; }
    a.forEach((_, i) => cmp(`${path}[${i}]`, a[i], b[i]));
  } else if (typeof a === "number" || typeof b === "number") {
    if (!close(a, b)) mism.push(`${path}: ${a} != ${b}`);
  } else if (a && typeof a === "object") {
    const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    for (const k of keys) cmp(path ? `${path}.${k}` : k, a?.[k], b?.[k]);
  } else if (a !== b) mism.push(`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
}
void NUM;
if (tsRes.length !== pyRes.length) { console.error("case count mismatch"); process.exit(2); }
tsRes.forEach((t, i) => cmp(`case[${i}](${cases[i].kind})`, t, pyRes[i]));

if (mism.length) {
  console.error(`PARITY FAIL — ${mism.length} mismatch(es):`);
  mism.slice(0, 40).forEach((m) => console.error("  " + m));
  process.exit(1);
}
console.log(`PARITY OK — ${cases.length} cases (TS planners match the Python reference exactly).`);
