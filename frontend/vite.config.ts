import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// Em dev local, proxy /api e /uploads pro backend de produção pra evitar CORS
// e poder logar com credenciais reais. Sem isso, browser bloqueia cookie de refresh
// cross-origin e o login falha após 15min mesmo conectando.
const PROD_BACKEND = "https://app.calebe.tech";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 5173,
    proxy: {
      "/api":      { target: PROD_BACKEND, changeOrigin: true, secure: true, ws: true },
      "/uploads":  { target: PROD_BACKEND, changeOrigin: true, secure: true },
      "/midias":   { target: PROD_BACKEND, changeOrigin: true, secure: true },
    },
  },
  build: { outDir: "dist", sourcemap: true, chunkSizeWarningLimit: 2000 }
});
