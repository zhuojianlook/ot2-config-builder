// qPCR planning — a faithful TypeScript port of reference/generate_platemap.py
// (generate_platemap / validate_config). A CI parity test fails the build if this
// diverges from the Python. KEEP IN SYNC with the qPCR protocol layout.

import type { Cfg } from "./cdna";

const ROWS_384 = "ABCDEFGHIJKLMNOP";
const NOZZLE_TO_ROW_A = [0, 2, 4, 6, 8, 10, 12, 14]; // A,C,E,G,I,K,M,O
const NOZZLE_TO_ROW_B = [1, 3, 5, 7, 9, 11, 13, 15]; // B,D,F,H,J,L,N,P
const STAIRSTEP_384 = [
  ["A1", "B1", "A2"], ["B2", "A3", "B3"], ["A4", "B4", "B5"], ["A5", "A6", "B6"],
  ["A7", "B7", "B8"], ["A8", "A9", "B9"], ["A10", "B10", "B11"], ["A11", "A12", "B12"],
  ["A13", "B13", "B14"], ["A14", "A15", "B15"], ["A16", "B16", "B17"], ["A17", "A18", "B18"],
];

export const QPCR_MAX_SAMPLES = NOZZLE_TO_ROW_A.length; // 8
export const QPCR_MAX_GENES = STAIRSTEP_384.length;     // 12
export const QPCR_MAX_REPS = 3;
const PLATE_WELLS = 384;

function asInt(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!/^[+-]?\d+$/.test(s)) return null;
  return parseInt(s, 10);
}

export interface PlatemapEntry { well: string; gene: string; sample: string; }

export function generatePlatemap(cfg: Cfg): {
  entries: PlatemapEntry[]; geneNames: string[]; sampleNames: string[];
} {
  const nSamples = asInt(cfg["num_samples"]) ?? 4;
  const nGenes = asInt(cfg["num_genes"]) ?? 5;
  const reps = asInt(cfg["replicates"]) ?? 3;

  const geneNames: string[] = [];
  for (let i = 1; i <= nGenes; i++) {
    const v = String(cfg[`gene_${i}`] ?? "").trim();
    geneNames.push(v || `Gene_${i}`);
  }
  const sampleNames: string[] = [];
  for (let i = 1; i <= nSamples; i++) {
    const v = String(cfg[`sample_${i}`] ?? "").trim();
    sampleNames.push(v || `Sample_${i}`);
  }

  const entries: PlatemapEntry[] = [];
  for (let g = 0; g < nGenes; g++) {
    const wells = STAIRSTEP_384[g].slice(0, reps);
    for (const addr of wells) {
      const addrRow = addr[0];
      const addrCol = parseInt(addr.slice(1), 10);
      const rowMap = addrRow === "A" ? NOZZLE_TO_ROW_A : NOZZLE_TO_ROW_B;
      for (let s = 0; s < nSamples; s++) {
        const well = `${ROWS_384[rowMap[s]]}${addrCol}`;
        entries.push({ well, gene: geneNames[g], sample: sampleNames[s] });
      }
    }
  }
  entries.sort((a, b) => {
    const ra = ROWS_384.indexOf(a.well[0]), rb = ROWS_384.indexOf(b.well[0]);
    if (ra !== rb) return ra - rb;
    return parseInt(a.well.slice(1), 10) - parseInt(b.well.slice(1), 10);
  });
  return { entries, geneNames, sampleNames };
}

export function validateConfig(cfg: Cfg): string[] {
  const errors: string[] = [];
  const ns = asInt(cfg["num_samples"]);
  const ng = asInt(cfg["num_genes"]);
  const reps = asInt(cfg["replicates"]);
  if (ns === null || !(ns >= 1 && ns <= QPCR_MAX_SAMPLES))
    errors.push(`num_samples must be 1-${QPCR_MAX_SAMPLES} (got ${cfg["num_samples"]})`);
  if (ng === null || !(ng >= 1 && ng <= QPCR_MAX_GENES))
    errors.push(`num_genes must be 1-${QPCR_MAX_GENES} (got ${cfg["num_genes"]})`);
  if (reps === null || !(reps >= 1 && reps <= QPCR_MAX_REPS))
    errors.push(`replicates must be 1-${QPCR_MAX_REPS} (got ${cfg["replicates"]})`);
  if (!errors.length && ns! * ng! * reps! > PLATE_WELLS)
    errors.push(`${ns} x ${ng} x ${reps} = ${ns! * ng! * reps!} reactions exceed the ${PLATE_WELLS}-well plate`);
  return errors;
}
