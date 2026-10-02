import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Relative base so the build works when served from a GitHub Pages project subpath.
  base: "./",
  plugins: [tailwindcss()],
  build: {
    modulePreload: false,
  },
});
