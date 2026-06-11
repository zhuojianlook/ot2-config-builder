// AUTO-GENERATED from reference/*_config_template.csv — the Settings-tab schema.
// Regenerate if the templates change (they mirror the robot protocol defaults).
export const CDNA_TEMPLATE = `Parameter,Value,Description
# === REACTION SETUP (usually leave as default) ===,,
elution_volume,38,uL of RNA actually in each tube (what you load)
rna_dead_volume,2,uL left in the RNA tube (robot never draws below this); usable = elution - this
target_ng,1500,ng of RNA to convert per sample (kit max per 30 uL reaction)
mastermix_per_rxn,10,uL master mix per reaction
rxn_total_vol,30,uL total per reaction (MM + RNA + water)
final_cdna_conc,6.25,ng/uL final diluted cDNA concentration
mastermix_excess_pct,30,Percent extra master mix to build (dead volume)
low_conc_action,skip,Below-hard-floor samples: skip (default) or convert
# === MASTER MIX RECIPE per reaction (uL) ===,,
mm_rt_buffer,2.0,10x RT Buffer
mm_dntp,0.8,25x dNTP Mix
mm_random_primer,2.0,10x Random Primers
mm_inhibitor,1.0,RNase Inhibitor
mm_enzyme,1.0,MultiScribe RT Enzyme
mm_water,3.2,Nuclease-free Water
# === SOURCE RESIDUALS (left behind so tubes are never drawn dry) ===,,
component_residual_uL,5,Extra uL to load in each MM component tube (not aspirated)
water_tube_fill_uL,450,uL to fill each 0.5 mL water tube
water_residual_uL,50,uL left in each water tube (usable = fill - residual)
mm_tube_usable_vol,420,Max master-mix volume one 0.5 mL MM tube can hold
# === TEMPERATURE / TECHNIQUE ===,,
offset_test_pause,false,Set true to pause at the bottom the first time each pipette enters each labware (height calibration); false for real runs
cold_temp,4,Temperature module setpoint (C) during assembly
use_temp_module,true,Set false to assemble at room temperature
p300_flow_rate_aqueous,40,uL/s aqueous flow rate (P300)
p300_flow_rate_viscous,25,uL/s viscous flow rate (master mix)
p20_flow_rate,6,uL/s flow rate for the P20
p20_min_vol,1.0,Minimum accurate P20 volume (uL); RNA below this skips the sample (pre-dilute manually)
p300_min_vol,20,Minimum accurate P300 volume (uL); pooling/dilution uses the P300 above this
aspirate_delay,0.5,seconds after each aspirate
dispense_delay,0.5,seconds after each dispense
mix_reps_mastermix,10,master-mix homogenise reps
mix_reps_reaction,8,per-reaction mix reps after RNA
mix_reps_dilute,8,final pooled+diluted cDNA mix reps
# === WELL HEIGHTS (mm from bottom; tune on the bench) ===,,
p20_z_offset,14.0,mm added to EVERY P20 height to fix the P20 reading too deep after a P300 labware position check (Opentrons bug 9691)
p20_travel_z,135.0,Absolute deck-Z (mm) the P20 lifts to before each well-to-well move (anti-collision over the tube tops; measured safe ceiling ~140)
p20_travel_z_max,140.0,Hard clamp on p20_travel_z (the P20 gantry raises ArcOutOfBoundsError above ~140-145 mm)
tube_z_raise,0.0,extra mm to lift all in-tube tip heights if the shorter Sarstedt tube still presses the bottom (watch small component tubes for air)
tube_z,1.5,base asp/disp height in 0.5 mL tubes (tube_z_raise is added on top)
tube_z_low,0.6,base low draw height for near-empty tubes
mm_tube_z,1.0,base asp/disp height in the master-mix tube
plate_z,1.0,asp/disp height in PCR-plate wells (no raise applied)
rna_dispense_z,2.0,RNA dispense height into the reaction (~1mm above plate_z so it delivers right at the tube; raise only if the tip dips into the reaction)
tube_p20_adjust,-1.0,fine depth for P20 in the 24-well racks (negative = deeper)
tube_p300_adjust,0.05,fine depth for P300 in the 24-well racks (negative = deeper)
plate_p20_adjust,-6.0,fine depth for P20 in the PCR plate (negative = deeper); applies to the STACKED cold plate
plate_p300_adjust,-6.0,fine depth for P300 in the PCR plate (negative = deeper); applies to the STACKED cold plate
plate_bare_p20_adjust,0.0,P20 plate depth when use_temp_module=false (bare plate on the slot; the -6 above is only for the stacked cold plate)
plate_bare_p300_adjust,0.0,P300 plate depth when use_temp_module=false
pool_drain_step1,0.75,STEP 6 drain: mm to step the P300 DOWN below the contact height for the 1st scavenge pass (suck the PCR tube dry)
pool_drain_step2,0.1,STEP 6 drain: extra mm DOWN for the 2nd scavenge pass (total = step1+step2 below contact). OPEN-LOOP: keep above the tube bottom
pool_drain_vol,10.0,STEP 6 drain: uL scavenged per descending pass (mostly residual cDNA + air); set 0 to disable draining
# === LABWARE (built-in 0.5mL rack by default; no custom def needed) ===,,
rack_loadname,opentrons_24_tuberack_nest_0.5ml_screwcap,Built-in 0.5 mL screw-cap 24-rack; only change if you add a custom def to the robot
rack_namespace,opentrons,Namespace of the rack definition
cold_adapter_loadname,opentrons_96_well_aluminum_block,Aluminum block adapter on the temp module
cold_block_loadname,biorad_96_wellplate_200ul_pcr,Reaction plate on the cold block (PCR tubes / 96 hard plate)
cold_block_namespace,opentrons,Namespace of the cold-block plate def (change for a custom plate)
cold_block_version,,Version of the cold-block plate def (blank = auto-resolve; set only for an older/custom def)
# === DECK SLOTS ===,,
slot_rna_rack,1,Input RNA rack
slot_reagent_rack,2,Reagent rack (MM components + MM tube + water)
slot_output_rack,5,Output (diluted cDNA) rack -- NOT slot 3 (P20 hack overhang from slot 6)
slot_temp_module,4,Temperature module + cold block
slot_tips_20,6,20 uL filter tips (P20 single-tip hack; slot 3 in FRONT must be EMPTY)
slot_tips_20_overflow,,Optional second 20 uL tip rack (large batches; leave BLANK to disable — if set, its front-neighbour slot N-3 must also be empty)
slot_tips_300,7,200 uL filter tips (P300)
mm_tube_well,B1,Reagent-rack well holding the EMPTY master-mix tube
p20_mount,left,p20_multi_gen2 mount
p300_mount,right,p300_single_gen2 mount
# === SAMPLES (one set of 3 rows per sample; add as many as needed, max 24) ===,,
sample_1_name,WT_P4,Sample 1 label
sample_1_conc,150,Sample 1 RNA concentration (ng/uL)
sample_1_position,A1,Sample 1 RNA tube position on the input rack (A1..D6)
sample_2_name,KO_P4,
sample_2_conc,60,
sample_2_position,A2,
sample_3_name,,Fill in or delete
sample_3_conc,,
sample_3_position,,
`;

export const QPCR_TEMPLATE = `Parameter,Value,Description
# === PLATE / RUN (set on the qPCR tab) ===,,
num_samples,2,Number of cDNA samples (1-8); set from the Samples list
num_genes,3,Number of primer pairs / genes (1-12); set from the Genes list
replicates,3,Technical replicates per gene on the 384 plate (1-3)
use_premixed_primers,false,true = use pre-mixed 2uM primers (skips the dilution step); false = dilute from 10uM stock
# === REACTION VOLUMES (uL per 384-well reaction) ===,,
sybr_vol_per_rxn,5,uL SYBR GREEN per 384-well reaction
cdna_vol_per_rxn,2,uL cDNA per 384-well reaction
primer_vol_per_rxn,1.5,uL of EACH primer (F and R) per 384-well reaction
final_rxn_vol,10,uL total volume per 384-well reaction
# === CONCENTRATIONS ===,,
cdna_conc,6.25,ng/uL concentration of all cDNA samples
primer_stock_conc,10,uM stock primer concentration
primer_working_conc,1.33,uM working primer concentration after dilution
# === EXCESS / ERROR MARGINS (%) ===,,
sybr_error_pct,4,Percent extra SYBR GREEN to prepare
mastermix_error_pct,12.0,Percent extra for cDNA+SYBR distribution to tubes
cool_plate_error_pct,8.0,Percent extra for distribution to the 96 cool plate
primer_error_pct,50,Percent extra for primer dilution volume
# === TEMPERATURE / FLOW / MIXING ===,,
cool_plate_temp,10,Temperature (C) for the cooling module
p300_flow_rate_viscous,25,uL/s flow rate for viscous liquids (SYBR GREEN)
p300_flow_rate_aqueous,40,uL/s flow rate for aqueous liquids (cDNA/water)
p20_flow_rate_slow,4,uL/s slow flow rate for the p20 multi
mix_reps_sybr,5,Mix repetitions for SYBR pooling
mix_reps_mastermix,8,Mix repetitions for cDNA+SYBR in tubes
mix_reps_primer,10,Mix repetitions for primer dilution
mix_reps_96well,5,Mix repetitions on the 96 cool plate
mix_volume_pct,70,Percent of total volume to use for mixing (max 200uL)
mix_z_asp,1,mm from well bottom to aspirate during mixing
mix_z_disp,2.5,mm from well bottom to dispense during mixing
mix_x_offset,0,mm x-offset for dispense during mixing
tube_aspirate_z,3,mm from bottom of 1.5mL tube to aspirate from
tube_dispense_z,3,mm from bottom of 1.5mL tube to dispense into
aspirate_delay_viscous,0.75,seconds delay after aspirating viscous liquid
dispense_delay_viscous,0.5,seconds delay after dispensing viscous liquid
aspirate_delay_aqueous,0.25,seconds delay after aspirating aqueous liquid
dispense_delay_aqueous,0.25,seconds delay after dispensing aqueous liquid
air_gap_p300,5,uL air gap for p300 transfers
air_gap_p20,2,uL air gap for p20 transfers
push_out_384,1,uL extra push-out when dispensing into the 384 plate
p20_z_offset,15.0,P20 multi Z-offset (mm) to compensate for the labware position check bug
# === TUBE DEPTHS (mm from rack surface; tune for shorter tubes) ===,,
tube_ref_depth,35.8,Reference tube depth (1.5mL Eppendorf) in mm from rack surface
tube_depth_sybr,35.8,SYBR tube depth
tube_depth_cdna,35.8,cDNA tube depth
tube_depth_mixing,35.8,Mixing tube depth
tube_depth_primer,35.8,Primer stock tube depth (use 30.0 for shorter tubes)
tube_depth_water,35.8,Water tube depth
tube_depth_collation,35.8,Collation/premixed tube depth
# === GENES (names; up to 12) ===,,
gene_1,GAPDH,Gene 1 name
gene_2,KERA,Gene 2 name
gene_3,LUM,Gene 3 name
# === SAMPLES (names; up to 8) ===,,
sample_1,WT_P4,Sample 1 name
sample_2,KO_P4,Sample 2 name
`;
