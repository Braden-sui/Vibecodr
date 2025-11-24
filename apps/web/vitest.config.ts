import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import type { PluginOption } from "vite";
import path from "path";

const reactPlugin = react();

const config = {
  plugins: [reactPlugin] as unknown as PluginOption[],
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
      "@testing-library/user-event": path.resolve(__dirname, "./test-utils/user-event-stub.ts"),
    },
  },
};

export default defineConfig(config as unknown as import("vitest/config").UserConfigExport);
