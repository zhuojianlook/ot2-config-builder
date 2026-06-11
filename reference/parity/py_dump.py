#!/usr/bin/env python3
"""Parity dump (Python side): runs the REFERENCE planners on the same cases and
prints the same normalized structure as ts_entry.ts, for diffing."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import generate_cdna_labels as C   # noqa: E402
import generate_platemap as Q      # noqa: E402

PLAN_FIELDS = ("regime", "n_rxns", "rna_per_rxn", "water_per_rxn", "ng_converted",
               "pooled_vol", "hard_floor", "dilution_water", "final_vol", "final_conc",
               "flags", "rxn_wells", "out_well")


def cat_status(st):
    if st == "active":
        return "active"
    s = st.lower()
    if "non-positive" in s:
        return "nonpos"
    if "floor" in s:
        return "floor"
    if "pipette min" in s or "pre-dilute" in s:
        return "submin"
    if "no source position" in s:
        return "nopos"
    return "skip"


def err_tags(errs, kind):
    tags = []
    for e in errs:
        el = e.lower()
        if kind == "cdna":
            if "cold-block capacity" in el: tags.append("plate_cap")
            elif "output/rna rack" in el: tags.append("rack_cap")
            elif "duplicate rna" in el: tags.append("dup_pos")
            elif "not valid 24-rack" in el: tags.append("bad_pos")
            elif "single water draw" in el: tags.append("water_chunk")
            elif "water tube(s) but only" in el: tags.append("water_count")
            elif "exceeds one 0.5 ml mm tube" in el: tags.append("mm_vol")
            elif "mm_tube_well" in el: tags.append("mm_collide")
            elif "below the p300 minimum" in el: tags.append("p300_floor")
            elif "overhang" in el: tags.append("overhang")
            else: tags.append("?" + el[:20])
        else:
            if "num_samples" in el: tags.append("ns")
            elif "num_genes" in el: tags.append("ng")
            elif "replicates" in el: tags.append("reps")
            elif "exceed the 384" in el: tags.append("plate384")
            else: tags.append("?" + el[:20])
    return sorted(tags)


def dump_cdna(cfg):
    try:
        samples, active, out_slot, _cold = C.plan_all(cfg)
    except SystemExit:
        return {"budgetError": True, "samples": [], "errors": []}
    errs = C.validate_config(cfg, active)
    out = []
    for s in samples:
        d = {"idx": s["idx"], "cat": cat_status(s["status"])}
        for f in PLAN_FIELDS:
            if f in s:
                d[f] = s[f]
        out.append(d)
    return {"budgetError": False, "samples": out, "errors": err_tags(errs, "cdna"),
            "out_slot": out_slot}


def dump_qpcr(cfg):
    errs = Q.validate_config(cfg)
    entries = []
    if not errs:
        e, _g, _s = Q.generate_platemap(cfg)
        entries = [[w, g, sm] for (w, g, sm) in e]
    return {"errors": err_tags(errs, "qpcr"), "entries": entries}


def main():
    cases = json.load(open(sys.argv[1]))
    res = [dump_cdna(c["cfg"]) if c["kind"] == "cdna" else dump_qpcr(c["cfg"]) for c in cases]
    print(json.dumps(res))


if __name__ == "__main__":
    main()
