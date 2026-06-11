import "./style.css";
import { CDNA_TEMPLATE, QPCR_TEMPLATE } from "./planning/templates";
import {
  parseTemplate, settingsEntries, type Entry,
  cdnaIsSetting, cdnaSamplesFromEntries, cdnaAssembleCfg, cdnaWriteConfig, type CdnaSample,
  qpcrIsSetting, qpcrNamesFromEntries, qpcrAssembleCfg, qpcrWriteConfig,
} from "./planning/config";
import { planAll, validateConfig as cdnaValidate, type SamplePlan, type Cfg } from "./planning/cdna";
import {
  generatePlatemap, validateConfig as qpcrValidate,
  QPCR_MAX_GENES, QPCR_MAX_SAMPLES,
} from "./planning/qpcr";
import { plateSvg, coldBlockBlocked, wellColor } from "./plate";

const isTauri = "__TAURI_INTERNALS__" in window;
const RNA_WELLS: string[] = [];
for (const r of "ABCD") for (let c = 1; c <= 6; c++) RNA_WELLS.push(`${r}${c}`);
const CDNA_MAX = 24;

// --- tiny DOM helper --------------------------------------------------------
type Attrs = Record<string, any>;
function h(tag: string, attrs: Attrs = {}, ...kids: any[]): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "value") (e as any).value = v;
    else if (k === "checked") (e as any).checked = v;
    else e.setAttribute(k, String(v));
  }
  for (const kid of kids.flat()) if (kid != null) e.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return e;
}
const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

// --- file save (Rust command via dialog; browser download fallback) ---------
async function saveText(defaultName: string, text: string, ext: string, label: string): Promise<string | null> {
  if (isTauri) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { invoke } = await import("@tauri-apps/api/core");
    const path = await save({ defaultPath: defaultName, filters: [{ name: label, extensions: [ext] }] });
    if (!path) return null;
    await invoke("save_text", { path, contents: text });
    return path;
  }
  const a = h("a", { href: URL.createObjectURL(new Blob([text], { type: "text/plain" })), download: defaultName }) as HTMLAnchorElement;
  a.click();
  return defaultName;
}

// --- updater ----------------------------------------------------------------
function toast(msg: string) {
  const t = h("div", { class: "update-banner show", style: "position:fixed;bottom:16px;right:16px;z-index:99" }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 4000);
}
async function showVersion(span: HTMLElement) {
  // Read the REAL installed version from Tauri so the header always matches the
  // running build (was previously hardcoded and went stale after an update).
  if (isTauri) {
    try { const { getVersion } = await import("@tauri-apps/api/app"); span.textContent = "v" + (await getVersion()); return; } catch { /* fall through */ }
  }
  span.textContent = "dev";
}
async function checkUpdate(manual = false) {
  if (!isTauri) { if (manual) toast("Updates work only in the installed app."); return; }
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (update) {
      const banner = $("#update-banner");
      banner.classList.add("show");
      banner.replaceChildren(
        h("span", {}, `Update available: ${update.version}.`),
        h("button", {
          class: "btn small primary",
          onclick: async () => {
            banner.replaceChildren(h("span", {}, "Downloading update…"));
            await update.downloadAndInstall();
            const { relaunch } = await import("@tauri-apps/plugin-process");
            await relaunch();
          },
        }, "Install & restart"),
      );
    } else if (manual) toast("You're on the latest version.");
  } catch (e) { if (manual) toast("Update check failed: " + e); }
}

// --- settings form (shared) -------------------------------------------------
function settingsForm(entries: Entry[], settings: Cfg, onChange: () => void): HTMLElement {
  const grid = h("div", { class: "setgrid" });
  for (const e of entries) {
    if (e.kind === "section") { grid.append(h("div", { class: "sec" }, e.text.replace(/[#=]/g, "").trim())); continue; }
    if (settings[e.name] === undefined) settings[e.name] = e.value;
    grid.append(
      h("label", {}, e.name),
      h("input", { type: "text", value: String(settings[e.name]), oninput: (ev: any) => { settings[e.name] = ev.target.value; onChange(); } }),
      h("div", { class: "desc" }, e.desc),
    );
  }
  return h("details", { class: "settings" }, h("summary", {}, "Settings (advanced)"), grid);
}
function statusBar() { return h("div", { class: "statusbar" }, "Ready."); }
function setStatus(bar: HTMLElement, msg: string, level = "") { bar.className = "statusbar " + level; bar.textContent = msg; }
function mapBlock(label: string, svg: SVGElement | HTMLElement): HTMLElement {
  return h("div", { class: "mapblock" }, h("div", { class: "maplabel" }, label), svg as any);
}

// ============================================================================
// cDNA panel
// ============================================================================
function cdnaPanel(): HTMLElement {
  const entries = parseTemplate(CDNA_TEMPLATE);
  const setEntries = settingsEntries(entries, cdnaIsSetting);
  const settings: Cfg = {};
  let samples: CdnaSample[] = cdnaSamplesFromEntries(entries);
  if (!samples.length) samples = [{ name: "", conc: "", position: "" }];

  const bar = statusBar();
  const rowsBox = h("div", { class: "samples" });
  const preview = h("tbody");
  const deckMap = h("div", { class: "deckmap" });

  const readRows = () => Array.from(rowsBox.querySelectorAll(".srow")).map((r) => ({
    name: $<HTMLInputElement>(".s-name", r).value.trim(),
    conc: $<HTMLInputElement>(".s-conc", r).value.trim(),
    position: $<HTMLSelectElement>(".s-pos", r).value.trim().toUpperCase(),
  }));

  function refresh() {
    samples = readRows();
    const res = planAll(cdnaAssembleCfg(settings, samples));
    preview.replaceChildren();
    const errs: string[] = res.budgetError ? [res.budgetError] : cdnaValidate(cdnaAssembleCfg(settings, samples), res.active);
    for (const srow of samples) if (srow.conc && isNaN(Number(srow.conc)))
      preview.append(h("tr", { class: "skip" }, ...["name", "conc"].map((k) => h("td", {}, (srow as any)[k] || "—")), h("td", { colspan: 9 }, "concentration is not a number — DROPPED")));
    for (const s of res.samples as SamplePlan[]) {
      if (s.status === "active") {
        preview.append(h("tr", {},
          h("td", {}, s.name), h("td", {}, s.conc), h("td", {}, "R" + s.regime), h("td", {}, s.n_rxns),
          h("td", {}, (s.rxn_wells || []).join(" ")), h("td", {}, (s.rna_per_rxn || []).join("+")),
          h("td", {}, (s.water_per_rxn || []).join("+")), h("td", {}, `${res.outSlot}:${s.out_well}`),
          h("td", {}, s.final_vol), h("td", {}, s.final_conc), h("td", {}, (s.flags || []).join("; ") || "ok")));
      } else {
        preview.append(h("tr", { class: "skip" }, h("td", {}, s.name), h("td", {}, s.conc),
          ...Array(8).fill(0).map(() => h("td", {}, "—")), h("td", {}, s.status.replace(/^SKIP:\s*/, ""))));
      }
    }
    // deck maps: each active sample gets a colour shown across all three racks
    const rna = new Map(), cold = new Map(), out = new Map();
    res.active.forEach((s, i) => {
      const color = wellColor(i), label = String(i + 1);
      if (s.position) rna.set(s.position, { color, label, title: `${s.name}  (${s.position})` });
      (s.rxn_wells || []).forEach((w, k) => cold.set(w, { color, label, title: `${s.name}${(s.rxn_wells || []).length > 1 ? " rxn" + (k + 1) : ""}  (${w})` }));
      if (s.out_well) out.set(s.out_well, { color, label, title: `${s.name}  →  ${res.outSlot}:${s.out_well}` });
    });
    const slot = (k: string, d: string) => String((settings as any)[k] ?? d);
    deckMap.replaceChildren(
      mapBlock(`RNA input rack — slot ${slot("slot_rna_rack", "1")}`, plateSvg("ABCD".split(""), 6, rna)),
      mapBlock(`Cold-block reactions — slot ${slot("slot_temp_module", "4")}`, plateSvg("ABCDEFGH".split(""), 12, cold, coldBlockBlocked())),
      mapBlock(`Output (diluted cDNA) rack — slot ${res.outSlot}`, plateSvg("ABCD".split(""), 6, out)),
    );

    const nActive = res.active.length;
    if (errs.length) setStatus(bar, `${nActive} active — robot would REJECT: ${errs[0]}${errs.length > 1 ? ` (+${errs.length - 1} more)` : ""}`, "error");
    else setStatus(bar, `${nActive} active sample(s), ${res.active.reduce((a, s) => a + (s.n_rxns || 0), 0)} reaction(s). Ready to save.`, "ok");
  }

  function addRow(s: CdnaSample = { name: "", conc: "", position: "" }) {
    if (rowsBox.querySelectorAll(".srow").length >= CDNA_MAX) { setStatus(bar, `Max ${CDNA_MAX} samples (rack capacity).`, "warn"); return; }
    const row = h("div", { class: "srow" },
      h("input", { class: "s-name", type: "text", placeholder: "name", value: s.name, oninput: refresh }),
      h("input", { class: "s-conc", type: "text", placeholder: "ng/µL", value: s.conc, oninput: refresh }),
      h("select", { class: "s-pos", onchange: refresh }, h("option", { value: "" }, "—"), ...RNA_WELLS.map((w) => h("option", { value: w }, w))),
      h("button", { class: "btn small", onclick: () => { row.remove(); refresh(); } }, "Remove"));
    ($(".s-pos", row) as HTMLSelectElement).value = s.position;
    rowsBox.append(row);
  }
  samples.forEach(addRow);

  const errsOf = () => { const r = planAll(cdnaAssembleCfg(settings, readRows())); return r.budgetError ? [r.budgetError] : cdnaValidate(cdnaAssembleCfg(settings, readRows()), r.active); };

  const saveConfig = async () => {
    const e = errsOf();
    if (e.length && !confirm("The robot would reject this config:\n\n- " + e.join("\n- ") + "\n\nSave anyway?")) return;
    const path = await saveText("cDNA_config.csv", cdnaWriteConfig(setEntries, settings, readRows()), "csv", "CSV");
    if (path) setStatus(bar, `Saved ${path}`, "ok");
  };
  const saveLabels = async () => {
    const res = planAll(cdnaAssembleCfg(settings, readRows()));
    if (res.budgetError) { toast(res.budgetError); return; }
    const path = await saveText("cDNA_labels.csv", cdnaLabelsCsv(res.samples as SamplePlan[], res.outSlot), "csv", "CSV");
    if (path) setStatus(bar, `Saved labels: ${path}`, "ok");
  };

  return h("div", {},
    h("p", { class: "note" }, "Enter RNA samples (name, concentration, tube position). The live preview uses the robot's own planner; problems the robot would reject are flagged before you save."),
    h("div", { class: "row" }, h("button", { class: "btn", onclick: () => addRow() }, "+ Add sample"),
      h("button", { class: "btn", onclick: () => { rowsBox.replaceChildren(); addRow(); refresh(); } }, "Clear")),
    h("div", { class: "card" },
      h("div", { class: "srow", style: "font-weight:600;color:var(--muted)" }, h("div", {}, "Sample name"), h("div", {}, "Conc (ng/µL)"), h("div", {}, "RNA position"), h("div", {}, "")),
      rowsBox),
    settingsForm(setEntries, settings, refresh),
    h("div", { class: "card" }, h("h3", {}, "Plan preview"),
      h("table", { class: "grid" },
        h("thead", {}, h("tr", {}, ...["Sample", "ng/µL", "Regime", "#Rxn", "Cold-block", "RNA/rxn", "Water/rxn", "Out tube", "Final µL", "@ng/µL", "Status / flags"].map((t) => h("th", {}, t)))),
        preview)),
    h("div", { class: "card" }, h("h3", {}, "Well map (where each sample goes)"), deckMap),
    h("div", { class: "row" }, h("button", { class: "btn primary", onclick: saveConfig }, "Save config CSV"), h("button", { class: "btn", onclick: saveLabels }, "Save labels CSV")),
    bar,
    (refresh(), bar.parentElement ? document.createComment("") : document.createComment("")),
  );
}

function cdnaLabelsCsv(samples: SamplePlan[], outSlot: string): string {
  const cols = ["output_slot", "output_well", "sample_name", "conc_ng_uL", "status", "regime", "n_reactions",
    "reaction_wells_coldblock", "rna_per_rxn_uL", "water_per_rxn_uL", "ng_converted", "dilution_water_uL",
    "final_volume_uL", "final_conc_ng_uL", "flags"];
  const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [cols.join(",")];
  for (const s of samples) {
    const active = s.status === "active";
    lines.push([
      active ? outSlot : "", active ? s.out_well || "" : "", s.name, String(s.conc), s.status,
      String(s.regime ?? "-"), String(s.n_rxns ?? 0), active ? (s.rxn_wells || []).join(" ") : "",
      (s.rna_per_rxn || []).join("+"), (s.water_per_rxn || []).join("+"), String(s.ng_converted ?? 0),
      String(s.dilution_water ?? 0), String(s.final_vol ?? 0), String(s.final_conc ?? 0), (s.flags || []).join("; "),
    ].map((c) => q(String(c))).join(","));
  }
  return lines.join("\n") + "\n";
}

// ============================================================================
// qPCR panel
// ============================================================================
function qpcrPanel(): HTMLElement {
  const entries = parseTemplate(QPCR_TEMPLATE);
  const setEntries = settingsEntries(entries, qpcrIsSetting);
  const settings: Cfg = {};
  let genes = qpcrNamesFromEntries(entries, "gene_"); if (!genes.length) genes = [""];
  let samples = qpcrNamesFromEntries(entries, "sample_"); if (!samples.length) samples = [""];

  const bar = statusBar();
  const geneBox = h("div", { class: "namelist" });
  const sampBox = h("div", { class: "namelist" });
  const preview = h("tbody");
  const plateMap = h("div", { class: "deckmap" });
  const reps = h("input", { type: "number", min: 1, max: 3, value: 3, style: "width:60px", onchange: refresh }) as HTMLInputElement;
  const premixed = h("input", { type: "checkbox", onchange: refresh }) as HTMLInputElement;

  const namesOf = (box: HTMLElement) => Array.from(box.querySelectorAll<HTMLInputElement>(".nm")).map((i) => i.value.trim()).filter((v) => v);
  const cfgNow = () => qpcrAssembleCfg(settings, namesOf(geneBox), namesOf(sampBox), Math.max(1, Math.min(3, Number(reps.value) || 3)), premixed.checked);

  function refresh() {
    const cfg = cfgNow();
    const errs = qpcrValidate(cfg);
    preview.replaceChildren();
    const fills = new Map();
    const geneList = namesOf(geneBox);
    if (!errs.length) {
      const gi = new Map(geneList.map((g, i) => [g, i]));
      for (const e of generatePlatemap(cfg).entries) {
        preview.append(h("tr", {}, h("td", {}, e.well), h("td", {}, e.gene), h("td", {}, e.sample)));
        fills.set(e.well, { color: wellColor(gi.get(e.gene) ?? 0), title: `${e.well}: ${e.gene} / ${e.sample}` });
      }
    }
    plateMap.replaceChildren(
      plateSvg("ABCDEFGHIJKLMNOP".split(""), 24, fills),
      h("div", { class: "legend" }, ...geneList.map((g, i) => h("span", { class: "lg" }, h("span", { class: "sw", style: `background:${wellColor(i)}` }), g))),
    );
    const ng = namesOf(geneBox).length, ns = namesOf(sampBox).length;
    if (errs.length) setStatus(bar, "Cannot build plate: " + errs[0], "error");
    else setStatus(bar, `${ns} sample(s) × ${ng} gene(s) × ${reps.value} reps = ${ns * ng * Number(reps.value)} of 384 wells. Ready to save.`, "ok");
  }
  function addName(box: HTMLElement, limit: number, val = "") {
    if (box.querySelectorAll(".nrow").length >= limit) { setStatus(bar, `Max ${limit}.`, "warn"); return; }
    const row = h("div", { class: "nrow" },
      h("input", { class: "nm", type: "text", value: val, oninput: refresh }),
      h("button", { class: "btn small", onclick: () => { row.remove(); refresh(); } }, "Remove"));
    box.append(row);
  }
  genes.forEach((g) => addName(geneBox, QPCR_MAX_GENES, g));
  samples.forEach((s) => addName(sampBox, QPCR_MAX_SAMPLES, s));

  const saveConfig = async () => {
    const errs = qpcrValidate(cfgNow());
    if (errs.length && !confirm("The robot would reject this config:\n\n- " + errs.join("\n- ") + "\n\nSave anyway?")) return;
    const path = await saveText("qPCR_config.csv", qpcrWriteConfig(entries, settings, namesOf(geneBox), namesOf(sampBox), Number(reps.value), premixed.checked), "csv", "CSV");
    if (path) setStatus(bar, `Saved ${path}`, "ok");
  };
  const savePlatemap = async () => {
    const cfg = cfgNow();
    if (qpcrValidate(cfg).length) { toast("Fix the errors before exporting the platemap."); return; }
    const path = await saveText("qPCR_platemap.txt", qpcrPlatemapTxt(cfg), "txt", "Text");
    if (path) setStatus(bar, `Saved platemap: ${path}`, "ok");
  };

  return h("div", {},
    h("p", { class: "note" }, "Name your genes and samples, choose replicates and primer mode. The preview shows the 384-well stairstep plate map the robot will build."),
    h("div", { class: "opts" },
      h("label", {}, "Replicates: ", reps),
      h("label", {}, premixed, " Use pre-mixed 2µM primers (skip dilution)")),
    h("div", { class: "cols" },
      h("div", { class: "card" }, h("h3", {}, `Genes (max ${QPCR_MAX_GENES})`), h("button", { class: "btn small", onclick: () => addName(geneBox, QPCR_MAX_GENES) }, "+ Add gene"), geneBox),
      h("div", { class: "card" }, h("h3", {}, `Samples (max ${QPCR_MAX_SAMPLES})`), h("button", { class: "btn small", onclick: () => addName(sampBox, QPCR_MAX_SAMPLES) }, "+ Add sample"), sampBox)),
    settingsForm(setEntries, settings, refresh),
    h("div", { class: "card" }, h("h3", {}, "384-well plate map"), plateMap),
    h("details", { class: "settings" }, h("summary", {}, "Plate map as a table"),
      h("table", { class: "grid" }, h("thead", {}, h("tr", {}, h("th", {}, "384 well"), h("th", {}, "Gene"), h("th", {}, "Sample"))), preview)),
    h("div", { class: "row" }, h("button", { class: "btn primary", onclick: saveConfig }, "Save config CSV"), h("button", { class: "btn", onclick: savePlatemap }, "Save platemap")),
    bar,
    (refresh(), document.createComment("")),
  );
}

function qpcrPlatemapTxt(cfg: Cfg): string {
  const { entries, geneNames, sampleNames } = generatePlatemap(cfg);
  const reps = cfg.replicates ?? 3;
  const premixed = String(cfg.use_premixed_primers ?? "false").toLowerCase() === "true";
  const lines = [
    "# qPCR Plate Map — Generated by OT-2 Config Builder",
    `# ${sampleNames.length} samples x ${geneNames.length} genes x ${reps} replicates = ${entries.length} wells`,
    `# Primer mode: ${premixed ? "Pre-mixed 2uM" : "Diluted from 10uM stock"}`,
    `# Genes: ${geneNames.join(", ")}`,
    `# Samples: ${sampleNames.join(", ")}`,
    "#", "Cell Position\tGene\tSample",
  ];
  for (const e of entries) lines.push(`${e.well}\t${e.gene}\t${e.sample}`);
  return lines.join("\n") + "\n";
}

// ============================================================================
// shell
// ============================================================================
function main() {
  const app = $("#app");
  const qpcr = qpcrPanel(), cdna = cdnaPanel();
  const panels: Record<string, HTMLElement> = {
    qPCR: h("div", { class: "panel active" }, qpcr),
    cDNA: h("div", { class: "panel" }, cdna),
  };
  const tabBtns = Object.keys(panels).map((name, i) =>
    h("button", { class: "tab" + (i === 0 ? " active" : ""), onclick: () => select(name) }, name));
  function select(name: string) {
    tabBtns.forEach((b) => b.classList.toggle("active", b.textContent === name));
    Object.entries(panels).forEach(([n, p]) => p.classList.toggle("active", n === name));
  }
  const verSpan = h("span", { class: "ver" }, "");
  showVersion(verSpan);
  app.append(
    h("header", { class: "app" }, h("h1", {}, "OT-2 Config Builder"), verSpan,
      h("span", { class: "spacer" }), h("button", { class: "btn small", onclick: () => checkUpdate(true) }, "Check for updates")),
    h("div", { id: "update-banner", class: "update-banner" }),
    h("div", { class: "tabs" }, ...tabBtns),
    ...Object.values(panels),
  );
  checkUpdate(false);
}
main();
