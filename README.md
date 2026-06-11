# OT-2 Config Builder

A small desktop app (Tauri) that builds the **config CSVs** for two OT-2 workflows,
with a live preview that uses the robots' own planning logic — and a built-in
**auto-updater**, so new versions install themselves in place.

- **qPCR tab** — name genes + samples, set replicates and primer mode, preview the
  384-well stairstep plate map, export `qPCR_config.csv` (+ a `platemap.txt`).
- **cDNA tab** — enter samples (name / concentration / RNA position), preview the
  per-sample plan, export `cDNA_config.csv` (+ a per-tube label sheet). Settings the
  robot would reject (deck collisions, water-tube count, etc.) are flagged before save.

## Install

Grab the latest build from the [Releases](../../releases/latest) page:

- **Linux** (the OT-2 laptop): download the `.AppImage`, then
  ```bash
  chmod +x OT-2*.AppImage && ./OT-2*.AppImage
  ```
  On Ubuntu 22.04+ you may need `sudo apt install libfuse2` (or run with
  `--appimage-extract-and-run`). There's also a `.deb`.
- **macOS**: open the `.dmg`, drag the app to Applications (first launch:
  right-click → **Open** once to clear Gatekeeper).

After the first install, the app **checks for updates on launch** and via the
**Check for updates** button, and installs them in place — no reinstall.

## Releasing a new version (maintainer)

1. Bump `version` in `package.json` **and** `src-tauri/tauri.conf.json` (keep them equal).
2. Tag and push:
   ```bash
   git tag v0.1.1 && git push origin v0.1.1
   ```
3. GitHub Actions (`.github/workflows/release.yml`) builds + signs Linux & macOS
   bundles and publishes them plus `latest.json` to a Release. Installed apps pick
   it up automatically.

Requires two repo secrets (set once): `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (the minisign key matching the `pubkey` in
`tauri.conf.json`).

## How the planning stays correct

The robot protocols are Python. The app reimplements their planning math in
**TypeScript** (`src/planning/`), and a **CI parity test**
(`reference/parity/`) runs both the TS planners and the committed Python reference
planners (`reference/generate_*.py`) over a battery of configs on every push — if
they ever disagree, the build fails. So the live preview can't silently drift from
what the robot does. When a protocol changes, update the Python reference here and
the TS to match; CI enforces agreement.

## Develop

```bash
npm install
npm run parity      # TS-vs-Python planner parity test
npm run tauri dev   # run the app (needs Rust + the Tauri system deps)
```
