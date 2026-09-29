import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(root, "src") } },
  server: {
    host: "0.0.0.0",
    port: 5174,
    proxy: { "/api": "http://localhost:3001" },
  },
  preview: { host: "0.0.0.0", port: 5174 },
});
