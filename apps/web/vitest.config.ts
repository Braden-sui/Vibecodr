import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

// SAFETY: Vitest pulls Vite 5 types while the workspace uses Vite 6; cast to align plugin typing.
const reactPlugin = react() as any;

export default defineConfig({
  plugins: [reactPlugin],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    pool: "threads",
    poolOptions: {
      threads: {
        minThreads: 1,
        maxThreads: 4,
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "**/*.config.ts",
        "**/*.d.ts",
        "**/__tests__/**",
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 65,
        statements: 70,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
