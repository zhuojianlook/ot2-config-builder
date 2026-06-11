// cDNA planning — a faithful TypeScript port of reference/generate_cdna_labels.py
// (plan_sample / plan_all / validate_config). A CI parity test fails the build if
// this ever diverges from the Python. KEEP IN SYNC with cDNA_Dynamic_v7.py.

export type Cfg = Record<string, string | number>;

export interface SamplePlan {
  idx: number; name: string; conc: number; position: string;
  status: string;
  regime?: number; n_rxns?: number;
  rna_per_rxn?: number[]; water_per_rxn?: number[];
  ng_converted?: number; pooled_vol?: number; pooled_conc?: number;
  hard_floor?: number; dilution_water?: number; final_vol?: number;
  final_conc?: number; flags?: string[];
  rxn_wells?: string[]; out_well?: string;
}

const PLATE_ROWS = "BCDEFG";
const RNA_WELLS = new Set<string>();
for (const r of "ABCD") for (let c = 1; c <= 6; c++) RNA_WELLS.add(`${r}${c}`);
const MM_COMPONENT_WELLS = ["A1", "A2", "A3", "A4", "A5", "A6"];
const WATER_WELLS = ["C1", "C2", "C3", "C4", "C5", "C6", "D1", "D2", "D3", "D4", "D5", "D6"];

// Python round() is round-half-to-even; mirror it so 2-decimal CSV values match.
export function pyRound(x: number, n = 2): number {
  if (!isFinite(x)) return x;
  const m = Math.pow(10, n);
  const y = x * m;
  const floor = Math.floor(y);
  const diff = y - floor;
  let r: number;
  if (Math.abs(diff - 0.5) < 1e-9) r = floor % 2 === 0 ? floor : floor + 1; // half to even
  else r = Math.round(y);
  return r / m;
}
const r2 = (x: number) => pyRound(x, 2);
const r3 = (x: number) => pyRound(x, 3);

export function cfgGet(cfg: Cfg, key: string, def: number): number;
export function cfgGet(cfg: Cfg, key: string, def: string): string;
export function cfgGet(cfg: Cfg, key: string, def: number | string): number | string {
  const v = cfg[key];
  if (v === undefined || v === "" || v === null) return def;
  return typeof def === "number" ? Number(v) : String(v);
}

function chunks(vol: number, maxV: number): number[] {
  vol = r2(vol);
  if (vol <= 0) return [];
  const n = Math.max(1, Math.ceil(vol / maxV));
  const base = r2(vol / n);
  const out: number[] = [];
  for (let i = 0; i < n - 1; i++) out.push(base);
  out.push(r2(vol - base * (n - 1)));
  return out.filter((c) => c > 0);
}

function simWaterTubes(draws: number[], usable: number): number {
  const remaining = [usable];
  let i = 0;
  for (const v of draws) {
    while (remaining[i] < v) {
      i++;
      if (i >= remaining.length) remaining.push(usable);
    }
    remaining[i] -= v;
  }
  return remaining.length;
}

function rackWells(n: number, rows = "ABCD", nCols = 6): string[] {
  const out: string[] = [];
  for (let c = 1; c <= nCols; c++)
    for (const r of rows) {
      out.push(`${r}${c}`);
      if (out.length >= n) return out;
    }
  return out;
}

export function reactionWells(sampleIndex: number, nRxns: number): string[] {
  const colPair = Math.floor(sampleIndex / PLATE_ROWS.length);
  const row = PLATE_ROWS[sampleIndex % PLATE_ROWS.length];
  const c1 = 2 + 2 * colPair;
  return nRxns === 1 ? [`${row}${c1}`] : [`${row}${c1}`, `${row}${c1 + 1}`];
}

export function extractSamples(cfg: Cfg, maxIdx = 96): SamplePlan[] {
  const out: SamplePlan[] = [];
  for (let i = 1; i <= maxIdx; i++) {
    const cRaw = cfg[`sample_${i}_conc`];
    if (cRaw === undefined || cRaw === "" || cRaw === null) continue;
    const conc = Number(cRaw);
    if (!isFinite(conc)) continue;
    const name = (String(cfgGet(cfg, `sample_${i}_name`, `Sample_${i}`)).trim()) || `Sample_${i}`;
    const pos = String(cfgGet(cfg, `sample_${i}_position`, "")).trim().toUpperCase();
    out.push({ idx: i, name, conc, position: pos, status: "" });
  }
  return out;
}

export interface PlanResult {
  regime: number; n_rxns: number;
  rna_per_rxn: number[]; water_per_rxn: number[];
  ng_converted: number; pooled_vol: number; pooled_conc: number;
  hard_floor: number; dilution_water: number; final_vol: number;
  final_conc: number; flags: string[];
}

export function planSample(conc: number, elutionVol: number, targetNg: number,
                           mmPerRxn: number, rxnTotal: number, finalConc: number,
                           minPipet = 1.0): PlanResult {
  const budget = rxnTotal - mmPerRxn;
  const vRnaTarget = targetNg / conc;
  const flags: string[] = [];
  let n: number, regime: number, rna: number[], ng: number;
  if (vRnaTarget <= elutionVol) {
    n = Math.max(1, Math.ceil(vRnaTarget / budget));
    regime = n === 1 ? 1 : 2;
    rna = Array(n).fill(vRnaTarget / n);
    ng = targetNg;
  } else {
    regime = 3;
    n = elutionVol <= budget ? 1 : 2;
    rna = Array(n).fill(elutionVol / n);
    ng = elutionVol * conc;
  }
  const water = rna.map((r) => budget - r);
  const pooledVol = n * rxnTotal;
  const pooledConc = ng / pooledVol;
  const hardFloor = (finalConc * pooledVol) / elutionVol;
  let finalVol: number, dilutionWater: number, finalConcActual: number;
  if (pooledConc >= finalConc) {
    finalVol = ng / finalConc;
    dilutionWater = finalVol - pooledVol;
    finalConcActual = finalConc;
    if (dilutionWater > 0 && dilutionWater < minPipet) {
      flags.push("dilution<1uL: none added");
      dilutionWater = 0.0; finalVol = pooledVol; finalConcActual = pooledConc;
    }
  } else {
    flags.push("below_hard_floor");
    dilutionWater = 0.0; finalVol = pooledVol; finalConcActual = pooledConc;
  }
  if (rna.some((r) => r > 0 && r < minPipet)) flags.push("RNA<1uL: needs pre-dilution");
  if (water.some((w) => w > 0 && w < minPipet)) flags.push("top-up water<1uL: omitted");
  return {
    regime, n_rxns: n,
    rna_per_rxn: rna.map(r2), water_per_rxn: water.map(r2),
    ng_converted: r2(ng), pooled_vol: r2(pooledVol), pooled_conc: r3(pooledConc),
    hard_floor: r3(hardFloor), dilution_water: r2(dilutionWater), final_vol: r2(finalVol),
    final_conc: r3(finalConcActual), flags,
  };
}

export interface PlanAll {
  samples: SamplePlan[]; active: SamplePlan[]; outSlot: string; coldSlot: string;
  budgetError?: string;
}

export function planAll(cfg: Cfg): PlanAll {
  const elution = cfgGet(cfg, "elution_volume", 38.0);
  const rnaDead = cfgGet(cfg, "rna_dead_volume", 2.0);
  const usable = Math.max(0.0, elution - rnaDead);
  const target = cfgGet(cfg, "target_ng", 1500.0);
  const mm = cfgGet(cfg, "mastermix_per_rxn", 10.0);
  const rxn = cfgGet(cfg, "rxn_total_vol", 30.0);
  const budget = rxn - mm;
  if (budget <= 0 || usable > 2 * budget + 1e-6) {
    return {
      samples: [], active: [], outSlot: "5", coldSlot: "4",
      budgetError: `Config error: usable RNA ${usable} uL must fit in two ${budget} uL ` +
        `reactions (adjust rxn_total_vol/mastermix_per_rxn/elution_volume).`,
    };
  }
  const final = cfgGet(cfg, "final_cdna_conc", 6.25);
  const minP20 = cfgGet(cfg, "p20_min_vol", 1.0);
  const lowAction = String(cfgGet(cfg, "low_conc_action", "skip")).trim().toLowerCase();
  const outSlot = String(cfgGet(cfg, "slot_output_rack", "5"));
  const coldSlot = String(cfgGet(cfg, "slot_temp_module", "4"));

  const samples = extractSamples(cfg);
  for (const s of samples) {
    if (s.conc <= 0) { s.status = `SKIP: non-positive concentration (${s.conc})`; continue; }
    const p = planSample(s.conc, usable, target, mm, rxn, final, minP20);
    Object.assign(s, p);
    const below = p.flags.includes("below_hard_floor");
    const subul = p.flags.some((f) => f.includes("RNA<1uL"));
    if (below && lowAction !== "convert") s.status = `SKIP: below ${p.hard_floor} ng/uL floor`;
    else if (subul) s.status = "SKIP: RNA < pipette min (pre-dilute)";
    else if (!s.position) s.status = "SKIP: no source position";
    else s.status = "active";
  }
  const active = samples.filter((s) => s.status === "active");
  const outWells = rackWells(Math.max(active.length, 1));
  active.forEach((s, i) => {
    s.rxn_wells = reactionWells(i, s.n_rxns!);
    s.out_well = i < outWells.length ? outWells[i] : "";
  });
  return { samples, active, outSlot, coldSlot };
}

export function validateConfig(cfg: Cfg, active: SamplePlan[]): string[] {
  const errors: string[] = [];
  if (active.length > 30) errors.push(`${active.length} active samples exceed cold-block capacity (30)`);
  else if (active.length > 24)
    errors.push(`${active.length} active samples exceed output/RNA rack capacity (24); add a rack`);

  const pos = active.map((s) => s.position);
  const dups = [...new Set(pos.filter((p) => p && pos.filter((q) => q === p).length > 1))].sort();
  if (dups.length) errors.push(`Duplicate RNA source position(s) [${dups.map((d) => `'${d}'`).join(", ")}] among active samples`);
  const bad = [...new Set(pos.filter((p) => p && !RNA_WELLS.has(p)))].sort();
  if (bad.length) errors.push(`RNA source position(s) [${bad.map((d) => `'${d}'`).join(", ")}] are not valid 24-rack wells (A1..D6)`);

  const mmPer = cfgGet(cfg, "mastermix_per_rxn", 10.0);
  const excess = 1 + cfgGet(cfg, "mastermix_excess_pct", 30.0) / 100.0;
  const minP20 = cfgGet(cfg, "p20_min_vol", 1.0);
  const minP300 = cfgGet(cfg, "p300_min_vol", 20.0);
  const totalRxns = active.reduce((a, s) => a + (s.n_rxns || 0), 0);
  const mmTotal = r2(mmPer * totalRxns * excess);
  const mmWaterVol = r2(cfgGet(cfg, "mm_water", 3.2) * totalRxns * excess);
  const waterUsable = cfgGet(cfg, "water_tube_fill_uL", 450.0) - cfgGet(cfg, "water_residual_uL", 50.0);
  const mmTubeUsable = cfgGet(cfg, "mm_tube_usable_vol", 420.0);

  const draws: number[] = [];
  if (mmWaterVol > 0) draws.push(...chunks(mmWaterVol, mmWaterVol > 20 ? 200 : 20));
  for (const s of active) for (const w of s.water_per_rxn || []) if (w >= minP20) draws.push(...chunks(w, 20));
  for (const useP300 of [true, false])
    for (const s of active) {
      const dv = s.dilution_water || 0.0;
      if (dv <= 0 || dv > 20 !== useP300) continue;
      draws.push(...chunks(dv, useP300 ? 200 : 20));
    }
  const maxChunk = draws.length ? Math.max(...draws) : 0.0;
  let nWater = 0;
  if (maxChunk > waterUsable + 1e-6)
    errors.push(`A single water draw (${r2(maxChunk)} uL) exceeds one tube's usable volume ` +
      `(${r2(waterUsable)} uL); raise water_tube_fill_uL or lower water_residual_uL`);
  else {
    nWater = draws.length ? simWaterTubes(draws, waterUsable) : 0;
    if (nWater > WATER_WELLS.length)
      errors.push(`Need ${nWater} water tube(s) but only ${WATER_WELLS.length} positions; ` +
        `use larger water tubes, add a rack, or split the batch`);
  }
  if (mmTotal > mmTubeUsable)
    errors.push(`Master mix ${mmTotal} uL exceeds one 0.5 mL MM tube (~${mmTubeUsable} uL); reduce batch`);
  const mmWell = String(cfgGet(cfg, "mm_tube_well", "B1"));
  const usedWater = WATER_WELLS.slice(0, nWater);
  if (MM_COMPONENT_WELLS.includes(mmWell) || usedWater.includes(mmWell))
    errors.push(`mm_tube_well ${mmWell} collides with a reagent/water well (components ` +
      `A1-A6, water [${usedWater.map((w) => `'${w}'`).join(", ")}]); pick an empty well (default B1)`);
  if (active.length) {
    let minWell = Infinity;
    for (const s of active)
      for (let k = 0; k < (s.n_rxns || 0); k++) {
        const w = s.water_per_rxn![k] >= minP20 ? s.water_per_rxn![k] : 0.0;
        minWell = Math.min(minWell, r2(mmPer + s.rna_per_rxn![k] + w));
      }
    if (minWell < minP300)
      errors.push(`Smallest assembled reaction volume ${minWell} uL is below the P300 minimum ` +
        `(${minP300} uL); increase rxn_total_vol or mastermix_per_rxn`);
  }
  const tipSlots = [String(cfgGet(cfg, "slot_tips_20", "6")), String(cfgGet(cfg, "slot_tips_20_overflow", ""))].filter((s) => s);
  const labwareSlots = new Set([
    String(cfgGet(cfg, "slot_rna_rack", "1")), String(cfgGet(cfg, "slot_reagent_rack", "2")),
    String(cfgGet(cfg, "slot_output_rack", "5")), String(cfgGet(cfg, "slot_temp_module", "4")),
    String(cfgGet(cfg, "slot_tips_300", "7")), ...tipSlots,
  ]);
  for (const ts of tipSlots) {
    const n = parseInt(ts, 10);
    if (isNaN(n)) continue;
    const front = String(n - 3);
    if (labwareSlots.has(front))
      errors.push(`Slot ${front} (in front of P20 tip-rack slot ${ts}) must stay EMPTY for the ` +
        `single-tip-hack overhang, but other labware is assigned there`);
  }
  return errors;
}
