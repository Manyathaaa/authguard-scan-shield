import { defineConfig } from "vite";
import type { Plugin } from 'vite';
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(async ({ mode }) => {
  // Dynamically load optional dev-only plugin without leaving Promises in the plugins array
  let devTagger: Plugin | null = null;
  if (mode === 'development') {
    try {
      // TypeScript may complain about missing types — this import is optional and development-only
      // @ts-expect-error -- optional dev dependency
      const mod = await import('lovable-tagger');
      devTagger = mod.componentTagger();
    } catch (err) {
      // if the package isn't present, skip the plugin
      devTagger = null;
    }
  }

  return {
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
  plugins: [react(), devTagger].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
  };
});
