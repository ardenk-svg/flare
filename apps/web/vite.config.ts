import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: process.env.FLARE_DEMO_GRANT_SERVER ? {
      "/__flare_demo": { target: process.env.FLARE_DEMO_GRANT_SERVER },
    } : undefined,
  },
});
