import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        secure: false,
      }
    },
  },
  plugins: [react(), (async () => {
    if (mode !== 'development') return null;
    try {
      // dynamic import so installs that don't include lovable-tagger won't fail
      const mod = await import('lovable-tagger');
      return mod.componentTagger();
    } catch (err) {
      // if the package isn't present, skip the plugin
      return null;
    }
  })()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
