/// <reference types="vitest" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // scripts/dev.py sets KELVIN_API_PORT when 8000 is taken by something else
    proxy: { "/api": { target: `http://127.0.0.1:${process.env.KELVIN_API_PORT || 8000}`, changeOrigin: true } },
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: { manualChunks: { charts: ["recharts"], map: ["leaflet", "leaflet-draw"] } },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    css: false,
  },
});
