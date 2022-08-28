import type { C8Options } from "vitest";
import { defineConfig } from "vitest/config";

const coverage: C8Options = {
  reporter: process.env.CI ? "lcovonly" : ["html", "text-summary"],
  include: ["packages/**/src/**/*.ts"],
};

if (process.env.COVERPKG) {
  coverage.include = [`${process.env.COVERPKG}/src/**/*.ts`];
  coverage.all = true;
}

export default defineConfig({
  test: {
    coverage,
    include: [
      "packages/**/tests/**/*.t.ts",
    ],
    teardownTimeout: 30000,
    watch: false,
  },
});
