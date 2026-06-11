"""
Generate a 384-well plate map file matching the OT-2 qPCR v4 protocol layout.

Reads a qPCR config CSV to determine:
  - num_samples, num_genes, replicates
  - gene_1, gene_2, ... (one per row in the CSV)
  - sample_1, sample_2, ... (one per row in the CSV)

Outputs a tab-separated platemap file compatible with qPCR analysis software.

The layout accounts for:
  - Stairstep pattern (A1,B1,A2 / B2,A3,B3 / ...)
  - 96-pitch multichannel on 384 plate (nozzle A->row A, nozzle B->row C, etc.)

Usage:
  python generate_platemap.py qPCR_config_2s_3g.csv
  python generate_platemap.py qPCR_config_2s_3g.csv -o my_platemap.txt
"""
import csv
import sys
import os
from datetime import datetime

ROWS_384 = list("ABCDEFGHIJKLMNOP")

# 96-pitch multichannel nozzle-to-384-row mapping:
# Nozzle A -> row 0 (A), Nozzle B -> row 2 (C), Nozzle C -> row 4 (E), etc.
# For A-offset addressing (well starts with A): rows A, C, E, G, I, K, M, O
# For B-offset addressing (well starts with B): rows B, D, F, H, J, L, N, P
NOZZLE_TO_ROW_A = [0, 2, 4, 6, 8, 10, 12, 14]   # A,C,E,G,I,K,M,O
NOZZLE_TO_ROW_B = [1, 3, 5, 7, 9, 11, 13, 15]   # B,D,F,H,J,L,N,P

STAIRSTEP_384 = [
    ["A1",  "B1",  "A2"],   ["B2",  "A3",  "B3"],
    ["A4",  "B4",  "B5"],   ["A5",  "A6",  "B6"],
    ["A7",  "B7",  "B8"],   ["A8",  "A9",  "B9"],
    ["A10", "B10", "B11"],  ["A11", "A12", "B12"],
    ["A13", "B13", "B14"],  ["A14", "A15", "B15"],
    ["A16", "B16", "B17"],  ["A17", "A18", "B18"],
]


def parse_config(csv_path):
    """Parse qPCR config CSV."""
    cfg = {}
    with open(csv_path, "r") as f:
        reader = csv.DictReader(f)
        for row in reader:
            param = row["Parameter"].strip()
            val = row["Value"].strip()
            cfg[param] = val
    return cfg


def generate_platemap(cfg):
    """Generate platemap entries: list of (well_384, gene_name, sample_name)."""
    n_samples = int(cfg.get("num_samples", 4))
    n_genes = int(cfg.get("num_genes", 5))
    reps = int(cfg.get("replicates", 3))

    # Parse per-row names: gene_1, gene_2, ... and sample_1, sample_2, ...
    gene_names = []
    for i in range(1, n_genes + 1):
        name = cfg.get(f"gene_{i}", "").strip()
        gene_names.append(name if name else f"Gene_{i}")

    sample_names = []
    for i in range(1, n_samples + 1):
        name = cfg.get(f"sample_{i}", "").strip()
        sample_names.append(name if name else f"Sample_{i}")

    entries = []

    for g in range(n_genes):
        wells_384 = STAIRSTEP_384[g][:reps]

        for well_addr in wells_384:
            # Parse the address: row letter + column number
            addr_row = well_addr[0]  # 'A' or 'B'
            addr_col = int(well_addr[1:])

            # Determine which 384 rows this address maps to for each sample
            if addr_row == "A":
                row_map = NOZZLE_TO_ROW_A
            else:
                row_map = NOZZLE_TO_ROW_B

            for s in range(n_samples):
                row_384_idx = row_map[s]
                row_384 = ROWS_384[row_384_idx]
                well_384 = f"{row_384}{addr_col}"

                entries.append((well_384, gene_names[g], sample_names[s]))

    # Sort by row then column for clean output
    def sort_key(entry):
        well = entry[0]
        row = ROWS_384.index(well[0])
        col = int(well[1:])
        return (row, col)

    entries.sort(key=sort_key)
    return entries, gene_names, sample_names


MAX_SAMPLES = len(NOZZLE_TO_ROW_A)      # 8 (96-pitch nozzles)
MAX_GENES = len(STAIRSTEP_384)          # 12 (stairstep blocks)
MAX_REPS = 3                            # wells per stairstep block
PLATE_WELLS = 384


def _as_int(v, default=None):
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return default


def validate_config(cfg):
    """Return a list of error strings for the qPCR layout limits the protocol
    enforces (samples 1-8, genes 1-12, replicates 1-3, total <= 384). [] == OK.
    KEEP IN SYNC with the qPCR protocol's layout."""
    errors = []
    ns = _as_int(cfg.get("num_samples"))
    ng = _as_int(cfg.get("num_genes"))
    reps = _as_int(cfg.get("replicates"))
    if ns is None or not (1 <= ns <= MAX_SAMPLES):
        errors.append(f"num_samples must be 1-{MAX_SAMPLES} (got {cfg.get('num_samples')})")
    if ng is None or not (1 <= ng <= MAX_GENES):
        errors.append(f"num_genes must be 1-{MAX_GENES} (got {cfg.get('num_genes')})")
    if reps is None or not (1 <= reps <= MAX_REPS):
        errors.append(f"replicates must be 1-{MAX_REPS} (got {cfg.get('replicates')})")
    if not errors and ns * ng * reps > PLATE_WELLS:
        errors.append(f"{ns} x {ng} x {reps} = {ns*ng*reps} reactions exceed the {PLATE_WELLS}-well plate")
    return errors


def write_platemap(cfg, out_path, config_name="config", timestamp=None):
    """Write the tab-separated platemap file and return (entries, genes, samples).
    Shared by the CLI and the GUI builder so the platemap format never diverges."""
    entries, gene_names, sample_names = generate_platemap(cfg)
    reps = _as_int(cfg.get("replicates"), 3)
    premixed = str(cfg.get("use_premixed_primers", "false")).strip().lower() in ("true", "yes", "1")
    ts = timestamp or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with open(out_path, "w") as f:
        f.write(f"# qPCR Plate Map — Generated {ts}\n")
        f.write(f"# Config: {config_name}\n")
        f.write(f"# {len(sample_names)} samples x {len(gene_names)} genes x {reps} replicates "
                f"= {len(entries)} wells\n")
        f.write(f"# Primer mode: {'Pre-mixed 2uM' if premixed else 'Diluted from 10uM stock'}\n")
        f.write(f"# Layout: Stairstep 384 ({', '.join(STAIRSTEP_384[0][:reps])}, ...)\n")
        f.write(f"# Genes: {', '.join(gene_names)}\n")
        f.write(f"# Samples: {', '.join(sample_names)}\n")
        f.write("#\n")
        f.write("Cell Position\tGene\tSample\n")
        for well, gene, sample in entries:
            f.write(f"{well}\t{gene}\t{sample}\n")
    return entries, gene_names, sample_names


def main():
    if len(sys.argv) < 2:
        print("Usage: python generate_platemap.py <config.csv> [-o output.txt]")
        print("  Add gene and sample names to the CSV (one per row):")
        print("  gene_1,GAPDH")
        print("  gene_2,KERA")
        print("  sample_1,WT_P4")
        print("  sample_2,KO_P4")
        sys.exit(1)

    csv_path = sys.argv[1]
    output_path = None
    if "-o" in sys.argv:
        idx = sys.argv.index("-o")
        if idx + 1 < len(sys.argv):
            output_path = sys.argv[idx + 1]

    if not output_path:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        base = os.path.splitext(os.path.basename(csv_path))[0]
        output_dir = os.path.dirname(csv_path) or "."
        output_path = os.path.join(output_dir, f"{timestamp}_{base}_platemap.txt")

    cfg = parse_config(csv_path)
    entries, gene_names, sample_names = write_platemap(cfg, output_path,
                                                       config_name=os.path.basename(csv_path))
    n_samples, n_genes = len(sample_names), len(gene_names)
    reps = _as_int(cfg.get("replicates"), 3)

    print(f"Platemap generated: {output_path}")
    print(f"  {n_samples} samples x {n_genes} genes x {reps} reps")
    print(f"  {len(entries)} wells mapped")
    print(f"  Genes:   {', '.join(gene_names)}")
    print(f"  Samples: {', '.join(sample_names)}")
    print(f"  Stairstep pattern: {', '.join(STAIRSTEP_384[0][:reps])}, ...")


if __name__ == "__main__":
    main()
