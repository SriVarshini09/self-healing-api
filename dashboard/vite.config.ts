import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = path.dirname(fileURLToPath(import.meta.url));

// Keep the public page's directory URL consistent in Vite and Nginx.
function landingRedirect(): Plugin {
  const middleware = (req: { url?: string }, res: { writeHead: (status: number, headers: Record<string, string>) => unknown; end: () => void }, next: () => void) => {
    const [pathname, query] = (req.url ?? "").split("?");
    if (pathname !== "/landing") return next();
    res.writeHead(308, { Location: `/landing/${query ? `?${query}` : ""}` });
    res.end();
  };
  return {
    name: "shapi-landing-directory",
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), landingRedirect()],
  build: {
    rollupOptions: {
      input: {
        dashboard: path.resolve(root, "index.html"),
        landing: path.resolve(root, "landing/index.html"),
      },
    },
  },
  resolve: { alias: { "@": path.resolve(root, "src") } },
  server: {
    host: "0.0.0.0",
    port: 5174,
    proxy: { "/api": "http://localhost:3001" },
  },
  preview: { host: "0.0.0.0", port: 5174 },
});
