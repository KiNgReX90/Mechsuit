import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // Only run the app's own tests; ignore FIRE/spec metadata harness files.
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
