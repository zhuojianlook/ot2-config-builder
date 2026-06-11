"""
Generate a tube-label CSV for the cDNA conversion protocol (cDNA_Dynamic_v9.py).

Reads a cDNA_config.csv (same file the robot uses) and writes a CSV listing, for
every sample, its OUTPUT tube position and the final cDNA volume + concentration
to write on the tube — plus the per-reaction breakdown and any skip reason.

The planning logic below is copied VERBATIM from cDNA_Dynamic_v9.py (plan_sample,
_extract_samples, _reaction_wells, _rack_wells) so labels always match the run.
Keep them in sync if the protocol changes. Runs on plain Python 3 (no opentrons).

Usage:
  python generate_cdna_labels.py cDNA_config.csv
  python generate_cdna_labels.py cDNA_config.csv -o my_labels.csv
"""
import csv
import sys
import os
import math

ROWS8 = "ABCDEFGH"


# --- config parsing (skips '#' comment rows) --------------------------------
def _coerce(v):
    v = str(v).strip()
    try:
        return int(v)
    except ValueError:
        try:
            return float(v)
        except ValueError:
            return v


def parse_config(path):
    cfg = {}
    with open(path) as f:
        for row in csv.DictReader(f):
            key = (row.get("Parameter") or "").strip()
            if not key or key.startswith("#"):
                continue
            cfg[key] = _coerce(row.get("Value") or "")
    return cfg


def _cfg(cfg, key, default):
    v = cfg.get(key, default)
    return v if v != "" else default


def _round(v):
    return round(float(v), 2)


# --- planning logic (mirrors cDNA_Dynamic_v9.py) ----------------------------
def _extract_samples(cfg, max_idx=96):
    out = []
    for i in range(1, max_idx + 1):
        conc = cfg.get(f"sample_{i}_conc", "")
        if conc == "" or conc is None:
            continue
        try:
            conc = float(conc)
        except (TypeError, ValueError):
            continue
        name = str(_cfg(cfg, f"sample_{i}_name", f"Sample_{i}")).strip() or f"Sample_{i}"
        pos = str(_cfg(cfg, f"sample_{i}_position", "")).strip().upper()
        out.append({"idx": i, "name": name, "conc": conc, "position": pos})
    return out


def plan_sample(conc, elution_vol, target_ng, mm_per_rxn, rxn_total, final_conc, min_pipet=1.0):
    budget = rxn_total - mm_per_rxn
    v_rna_target = target_ng / conc
    flags = []
    if v_rna_target <= elution_vol:
        n = max(1, math.ceil(v_rna_target / budget))
        regime = 1 if n == 1 else 2
        rna, ng = [v_rna_target / n] * n, target_ng
    else:
        regime = 3
        n = 1 if elution_vol <= budget else 2
        rna, ng = [elution_vol / n] * n, elution_vol * conc
    water = [budget - r for r in rna]
    pooled_vol = n * rxn_total
    pooled_conc = ng / pooled_vol
    hard_floor = final_conc * pooled_vol / elution_vol
    if pooled_conc >= final_conc:
        final_vol = ng / final_conc
        dilution_water = final_vol - pooled_vol
        final_conc_actual = final_conc
        if 0 < dilution_water < min_pipet:
            flags.append("dilution<1uL: none added")
            dilution_water, final_vol, final_conc_actual = 0.0, pooled_vol, pooled_conc
    else:
        flags.append("below_hard_floor")
        dilution_water, final_vol, final_conc_actual = 0.0, pooled_vol, pooled_conc
    if any(0 < r < min_pipet for r in rna):
        flags.append("RNA<1uL: needs pre-dilution")
    if any(0 < w < min_pipet for w in water):
        flags.append("top-up water<1uL: omitted")
    return {
        "regime": regime, "n_rxns": n,
        "rna_per_rxn": [_round(r) for r in rna], "water_per_rxn": [_round(w) for w in water],
        "ng_converted": _round(ng), "pooled_vol": _round(pooled_vol),
        "pooled_conc": round(pooled_conc, 3), "hard_floor": round(hard_floor, 3),
        "dilution_water": _round(dilution_water), "final_vol": _round(final_vol),
        "final_conc": round(final_conc_actual, 3), "flags": flags,
    }


def _rack_wells(n, rows="ABCD", n_cols=6):
    out = []
    for c in range(1, n_cols + 1):
        for r in rows:
            out.append(f"{r}{c}")
            if len(out) >= n:
                return out
    return out


PLATE_ROWS = "BCDEFG"   # usable rows (thermocycler blocks the A/H rim)

def _reaction_wells(sample_index, n_rxns):
    col_pair = sample_index // len(PLATE_ROWS)
    row = PLATE_ROWS[sample_index % len(PLATE_ROWS)]
    c1 = 2 + 2 * col_pair
    if n_rxns == 1:
        return [f"{row}{c1}"]
    return [f"{row}{c1}", f"{row}{c1 + 1}"]


# --- water provisioning + deck-well sets (mirror cDNA_Dynamic_v9.py) ----------
# These let the off-deck tools (this CLI + the GUI builder) refuse the SAME configs
# the robot's fail-fast asserts refuse. KEEP IN SYNC with the protocol.
def _chunks(vol, max_v):
    vol = _round(vol)
    if vol <= 0:
        return []
    n = max(1, math.ceil(vol / max_v))
    base = _round(vol / n)
    out = [base] * (n - 1)
    out.append(_round(vol - base * (n - 1)))
    return [c for c in out if c > 0]


def _sim_water_tubes(draws, usable):
    remaining = [float(usable)]
    i = 0
    for v in draws:
        while remaining[i] < v:
            i += 1
            if i >= len(remaining):
                remaining.append(float(usable))
        remaining[i] -= v
    return len(remaining)


_RNA_WELLS = {f"{r}{c}" for r in "ABCD" for c in range(1, 7)}        # A1..D6
_MM_COMPONENT_WELLS = ["A1", "A2", "A3", "A4", "A5", "A6"]
_WATER_WELLS = ["C1", "C2", "C3", "C4", "C5", "C6",
                "D1", "D2", "D3", "D4", "D5", "D6"]


def plan_all(cfg):
    """Classify + plan every sample and assign wells. Does NOT enforce capacity /
    deck guards (that's validate_config), so a GUI can show the plan AND the errors
    together. Raises SystemExit only on the budget precondition (needed before
    plan_sample can run). Returns (samples, active, out_slot, cold_slot)."""
    elution = float(_cfg(cfg, "elution_volume", 38.0))
    rna_dead = float(_cfg(cfg, "rna_dead_volume", 2.0))
    usable = max(0.0, elution - rna_dead)
    target = float(_cfg(cfg, "target_ng", 1500.0))
    mm = float(_cfg(cfg, "mastermix_per_rxn", 10.0))
    rxn = float(_cfg(cfg, "rxn_total_vol", 30.0))
    budget = rxn - mm
    if budget <= 0 or usable > 2 * budget + 1e-6:
        raise SystemExit(f"Config error: usable RNA {usable} uL must fit in two {budget} uL "
                         f"reactions (adjust rxn_total_vol/mastermix_per_rxn/elution_volume).")
    final = float(_cfg(cfg, "final_cdna_conc", 6.25))
    min_p20 = float(_cfg(cfg, "p20_min_vol", 1.0))
    low_action = str(_cfg(cfg, "low_conc_action", "skip")).strip().lower()
    # Default output slot 5 (NOT 3) to match the robot: slot 3 is in front of the
    # P20 tip rack and must stay EMPTY for the single-tip-hack overhang.
    out_slot = str(_cfg(cfg, "slot_output_rack", "5"))
    cold_slot = str(_cfg(cfg, "slot_temp_module", "4"))

    samples = _extract_samples(cfg)
    for s in samples:
        # Mirror the protocol: a non-positive concentration can't be planned
        # (1500/0 crashes; negative mis-plans). Skip before plan_sample.
        if s["conc"] <= 0:
            s["status"] = f"SKIP: non-positive concentration ({s['conc']})"
            continue
        s.update(plan_sample(s["conc"], usable, target, mm, rxn, final, min_p20))
        below = "below_hard_floor" in s["flags"]
        subul = any("RNA<1uL" in f for f in s["flags"])
        if below and low_action != "convert":
            s["status"] = f"SKIP: below {s['hard_floor']} ng/uL floor"
        elif subul:
            s["status"] = "SKIP: RNA < pipette min (pre-dilute)"
        elif not s["position"]:
            s["status"] = "SKIP: no source position"
        else:
            s["status"] = "active"
    active = [s for s in samples if s["status"] == "active"]
    out_wells = _rack_wells(max(len(active), 1))
    for i, s in enumerate(active):
        s["rxn_wells"] = _reaction_wells(i, s["n_rxns"])
        s["out_well"] = out_wells[i] if i < len(out_wells) else ""   # >24 flagged by validate_config
    return samples, active, out_slot, cold_slot


def validate_config(cfg, active):
    """Return a list of error strings for every settings/deck guard the robot
    (cDNA_Dynamic_v9.py) enforces: capacity, duplicate/illegal RNA positions,
    water-tube count + single-chunk size, MM-tube volume + well collision, the
    P300 pooling floor, and the P20 single-tip-hack overhang clearance. Empty list
    == OK. KEEP IN SYNC with cDNA_Dynamic_v9.py's fail-fast asserts."""
    errors = []
    # capacity (cold block 30; output/RNA 24)
    if len(active) > 30:
        errors.append(f"{len(active)} active samples exceed cold-block capacity (30)")
    elif len(active) > 24:
        errors.append(f"{len(active)} active samples exceed output/RNA rack capacity (24); add a rack")
    # RNA positions: duplicate + legal (A1..D6)
    pos = [s["position"] for s in active]
    dups = sorted({p for p in pos if p and pos.count(p) > 1})
    if dups:
        errors.append(f"Duplicate RNA source position(s) {dups} among active samples")
    bad = sorted(p for p in pos if p and p not in _RNA_WELLS)
    if bad:
        errors.append(f"RNA source position(s) {bad} are not valid 24-rack wells (A1..D6)")

    mm_per = float(_cfg(cfg, "mastermix_per_rxn", 10.0))
    excess = 1 + float(_cfg(cfg, "mastermix_excess_pct", 30.0)) / 100.0
    min_p20 = float(_cfg(cfg, "p20_min_vol", 1.0))
    min_p300 = float(_cfg(cfg, "p300_min_vol", 20.0))
    total_rxns = sum(s["n_rxns"] for s in active)
    mm_total = _round(mm_per * total_rxns * excess)
    mm_water_vol = _round(float(_cfg(cfg, "mm_water", 3.2)) * total_rxns * excess)
    water_usable = float(_cfg(cfg, "water_tube_fill_uL", 450.0)) - float(_cfg(cfg, "water_residual_uL", 50.0))
    mm_tube_usable = float(_cfg(cfg, "mm_tube_usable_vol", 420.0))

    # Mirror the runtime water-draw order: STEP1 MM water, STEP3 top-up, STEP5 dilution.
    draws = []
    if mm_water_vol > 0:
        draws += _chunks(mm_water_vol, 200 if mm_water_vol > 20 else 20)
    for s in active:
        for w in s.get("water_per_rxn", []):
            if w >= min_p20:
                draws += _chunks(w, 20)
    for use_p300 in (True, False):
        for s in active:
            dv = s.get("dilution_water", 0.0)
            if dv <= 0 or ((dv > 20) != use_p300):
                continue
            draws += _chunks(dv, 200 if use_p300 else 20)
    max_chunk = max(draws) if draws else 0.0
    n_water = 0
    if max_chunk > water_usable + 1e-6:
        errors.append(f"A single water draw ({_round(max_chunk)} uL) exceeds one tube's usable volume "
                      f"({_round(water_usable)} uL); raise water_tube_fill_uL or lower water_residual_uL")
    else:
        n_water = _sim_water_tubes(draws, water_usable) if draws else 0
        if n_water > len(_WATER_WELLS):
            errors.append(f"Need {n_water} water tube(s) but only {len(_WATER_WELLS)} positions; "
                          f"use larger water tubes, add a rack, or split the batch")
    if mm_total > mm_tube_usable:
        errors.append(f"Master mix {mm_total} uL exceeds one 0.5 mL MM tube (~{mm_tube_usable} uL); reduce batch")
    # MM tube well must not sit on a component (A1-A6) or water well
    mm_well = str(_cfg(cfg, "mm_tube_well", "B1"))
    used_water = _WATER_WELLS[:n_water]
    if mm_well in _MM_COMPONENT_WELLS or mm_well in used_water:
        errors.append(f"mm_tube_well {mm_well} collides with a reagent/water well (components "
                      f"A1-A6, water {used_water}); pick an empty well (default B1)")
    # P300 pooling floor: smallest assembled reaction volume
    if active:
        min_well = min(_round(mm_per + s["rna_per_rxn"][k]
                              + (s["water_per_rxn"][k] if s["water_per_rxn"][k] >= min_p20 else 0.0))
                       for s in active for k in range(s["n_rxns"]))
        if min_well < min_p300:
            errors.append(f"Smallest assembled reaction volume {min_well} uL is below the P300 minimum "
                          f"({min_p300} uL); increase rxn_total_vol or mastermix_per_rxn")
    # P20 single-tip-hack overhang: the slot in front of each tip rack (N-3) must be empty
    tip_slots = [s for s in (str(_cfg(cfg, "slot_tips_20", "6")),
                             str(_cfg(cfg, "slot_tips_20_overflow", ""))) if s]
    labware_slots = {str(_cfg(cfg, "slot_rna_rack", "1")), str(_cfg(cfg, "slot_reagent_rack", "2")),
                     str(_cfg(cfg, "slot_output_rack", "5")), str(_cfg(cfg, "slot_temp_module", "4")),
                     str(_cfg(cfg, "slot_tips_300", "7")), *tip_slots}
    for ts in tip_slots:
        try:
            front = str(int(ts) - 3)
        except (ValueError, TypeError):
            continue
        if front in labware_slots:
            errors.append(f"Slot {front} (in front of P20 tip-rack slot {ts}) must stay EMPTY for the "
                          f"single-tip-hack overhang, but other labware is assigned there")
    return errors


def build(cfg):
    """Plan + validate, raising SystemExit on the first guard violation (CLI
    fail-fast). The GUI calls plan_all + validate_config directly so it can show the
    plan AND every error at once."""
    samples, active, out_slot, cold_slot = plan_all(cfg)
    errors = validate_config(cfg, active)
    if errors:
        raise SystemExit(errors[0])
    return samples, active, out_slot, cold_slot


LABEL_COLS = ["output_slot", "output_well", "sample_name", "conc_ng_uL", "status",
              "regime", "n_reactions", "reaction_wells_coldblock", "rna_per_rxn_uL",
              "water_per_rxn_uL", "ng_converted", "dilution_water_uL",
              "final_volume_uL", "final_conc_ng_uL", "flags"]


def label_row(s, out_slot):
    """One label-CSV row for sample `s` (active or skipped). .get() defaults so a
    sample skipped BEFORE plan_sample (e.g. conc<=0) has no plan fields to read."""
    is_active = s["status"] == "active"
    return [
        out_slot if is_active else "",
        s.get("out_well", "") if is_active else "",
        s["name"], s["conc"], s["status"],
        s.get("regime", "-"), s.get("n_rxns", 0),
        " ".join(s.get("rxn_wells", [])) if is_active else "",
        "+".join(str(x) for x in s.get("rna_per_rxn", [])),
        "+".join(str(x) for x in s.get("water_per_rxn", [])),
        s.get("ng_converted", 0), s.get("dilution_water", 0),
        s.get("final_vol", 0), s.get("final_conc", 0),
        "; ".join(s.get("flags", [])),
    ]


def write_labels_csv(samples, active, out_slot, out_path):
    """Write the per-tube label CSV. Shared by the CLI and the GUI builder so the
    label format never diverges between them."""
    with open(out_path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(LABEL_COLS)
        for s in samples:
            w.writerow(label_row(s, out_slot))


def main():
    if len(sys.argv) < 2:
        print("Usage: python generate_cdna_labels.py <config.csv> [-o output.csv]")
        sys.exit(1)
    cfg_path = sys.argv[1]
    out_path = None
    if "-o" in sys.argv:
        out_path = sys.argv[sys.argv.index("-o") + 1]
    if not out_path:
        base = os.path.splitext(os.path.basename(cfg_path))[0]
        out_path = os.path.join(os.path.dirname(cfg_path) or ".", f"{base}_cdna_labels.csv")

    cfg = parse_config(cfg_path)
    samples, active, out_slot, cold_slot = build(cfg)
    write_labels_csv(samples, active, out_slot, out_path)

    print(f"Labels written: {out_path}")
    print(f"  {len(active)} active cDNA tube(s) on slot {out_slot}, "
          f"{len(samples) - len(active)} skipped")
    for s in active:
        print(f"    {out_slot}:{s['out_well']}  {s['name']:14s} "
              f"{s['final_vol']:6.1f} uL @ {s['final_conc']} ng/uL  (cold-block {s['rxn_wells']})")
    for s in samples:
        if s["status"] != "active":
            print(f"    [skip] {s['name']:14s} {s['status']}")


if __name__ == "__main__":
    main()
