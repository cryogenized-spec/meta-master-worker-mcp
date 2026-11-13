import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        d1Databases: { META_DB: "00000000-0000-4000-8000-000000000001" },
        kvNamespaces: ["OAUTH_KV"],
      },
    }),
  ],
  test: {
    include: ["tests/integration/**/*.integration.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    maxWorkers: 1,
  },
});
