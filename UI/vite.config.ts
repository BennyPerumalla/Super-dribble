import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  base: "./",
  publicDir: false,
  server: {
    host: "::",
    port: 8080,
    open: "/",
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@components": path.resolve(__dirname, "./src/components"),
      "@lib": path.resolve(__dirname, "./src/lib"),
      "@equalizer": path.resolve(__dirname, "./src/equalizer"),
      "@pages": path.resolve(__dirname, "./src/pages"),
      "@types": path.resolve(__dirname, "./src/types"),
    },
  },
  build: {
    outDir: "build",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: "./index.html",
      },
      output: {
        entryFileNames: "assets/main-BCOVmn2O.js",
        chunkFileNames: (chunkInfo) => {
          if (chunkInfo.name === "LuaPresetManager") {
            return "assets/LuaPresetManager-BIxQlNX6.js";
          }
          if (chunkInfo.name === "lua-preset-parser") {
            return "assets/lua-preset-parser-ByQ3BOJ_.js";
          }
          return "assets/[name]-[hash].js";
        },
        assetFileNames: (assetInfo) =>
          assetInfo.names.some((name) => name.endsWith(".css"))
            ? "assets/main-CtJRbM6p.css"
            : "assets/[name]-[hash][extname]",
      },
    },
  },
}));
