import { defineConfig } from "vite";
import { resolve } from "path";

// The entry point is galaxy.html (not index.html) to match the project's
// naming convention carried over from the wider AXIOM ecosystem.
export default defineConfig({
  base: "./",
  build: {
    rollupOptions: {
      input: resolve(__dirname, "galaxy.html"),
    },
  },
  server: {
    open: "/galaxy.html",
  },
});
