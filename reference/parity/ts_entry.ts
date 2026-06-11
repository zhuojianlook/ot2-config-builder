// Parity dump (TS side): runs the TS planners on a list of cases and returns a
// normalized structure for comparison against the Python reference.
import { planAll, validateConfig as vC, type Cfg } from "../../src/planning/cdna";
import { generatePlatemap, validateConfig as vQ } from "../../src/planning/qpcr";

function catStatus(st: string): string {
  if (st === "active") return "active";
  const s = st.toLowerCase();
  if (s.includes("non-positive")) return "nonpos";
  if (s.includes("floor")) return "floor";
  if (s.includes("pipette min") || s.includes("pre-dilute")) return "submin";
  if (s.includes("no source position")) return "nopos";
  return "skip";
}

function errTags(errs: string[], kind: string): string[] {
  const tags: string[] = [];
  for (const e of errs) {
    const el = e.toLowerCase();
    if (kind === "cdna") {
      if (el.includes("cold-block capacity")) tags.push("plate_cap");
      else if (el.includes("output/rna rack")) tags.push("rack_cap");
      else if (el.includes("duplicate rna")) tags.push("dup_pos");
      else if (el.includes("not valid 24-rack")) tags.push("bad_pos");
      else if (el.includes("single water draw")) tags.push("water_chunk");
      else if (el.includes("water tube(s) but only")) tags.push("water_count");
      else if (el.includes("exceeds one 0.5 ml mm tube")) tags.push("mm_vol");
      else if (el.includes("mm_tube_well")) tags.push("mm_collide");
      else if (el.includes("below the p300 minimum")) tags.push("p300_floor");
      else if (el.includes("overhang")) tags.push("overhang");
      else tags.push("?" + el.slice(0, 20));
    } else {
      if (el.includes("num_samples")) tags.push("ns");
      else if (el.includes("num_genes")) tags.push("ng");
      else if (el.includes("replicates")) tags.push("reps");
      else if (el.includes("exceed the 384")) tags.push("plate384");
      else tags.push("?" + el.slice(0, 20));
    }
  }
  return tags.sort();
}

const PLAN_FIELDS = ["regime", "n_rxns", "rna_per_rxn", "water_per_rxn", "ng_converted",
  "pooled_vol", "hard_floor", "dilution_water", "final_vol", "final_conc", "flags",
  "rxn_wells", "out_well"] as const;

function dumpCdna(cfg: Cfg) {
  const { samples, active, outSlot, budgetError } = planAll(cfg);
  if (budgetError) return { budgetError: true, samples: [], errors: [] };
  const errs = vC(cfg, active);
  const out = samples.map((s) => {
    const d: any = { idx: s.idx, cat: catStatus(s.status) };
    for (const f of PLAN_FIELDS) if ((s as any)[f] !== undefined) d[f] = (s as any)[f];
    return d;
  });
  return { budgetError: false, samples: out, errors: errTags(errs, "cdna"), out_slot: outSlot };
}

function dumpQpcr(cfg: Cfg) {
  const errs = vQ(cfg);
  let entries: string[][] = [];
  if (!errs.length) entries = generatePlatemap(cfg).entries.map((e) => [e.well, e.gene, e.sample]);
  return { errors: errTags(errs, "qpcr"), entries };
}

export function dumpAll(cases: Array<{ kind: string; cfg: Cfg }>) {
  return cases.map((c) => (c.kind === "cdna" ? dumpCdna(c.cfg) : dumpQpcr(c.cfg)));
}
