import { defineConfig } from "vite";

// Tauri-friendly Vite config. The dev server is fixed to 1420 to match
// tauri.conf.json's devUrl; the build emits to ../dist (frontendDist).
export default defineConfig({
  clearScreen: false,
  server: { host: "127.0.0.1", port: 1420, strictPort: true },
  build: { target: "es2021", sourcemap: false, emptyOutDir: true },
});
